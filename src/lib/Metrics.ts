
// includes
import { v4 as uuid } from "uuid";
import axios from "axios";
import { Router } from "express";
import * as path from "path";
import shortid = require("shortid");
import * as chokidar from "chokidar";
import moment = require("moment");
import FileHandler from "./FileHandler";
import Metric, { MetricJSON, Chart, Series, DataPoint } from "./Metric.js";
import Configuration from "./Configuration.js";

type modes = "controller" | "dispatcher";

export interface MetricsJSON {
    mode:  modes,
    url?:  string,
    path?: string,
    storageKey?: string,
    storageSas?: string
}

interface MetricsFileFormat {
    code:    string,
    metrics: MetricJSON[]
}

export default class Metrics extends FileHandler<Metric> {

    public  mode:    modes;
    public  router?: Router;

    /* Stores the last code generated for metrics received from a node. */
    private codes: {
        [node: string]: string
    } = {};

    public add(name: string, config: string, file: string, v: number) {
        const existing = this.find(metric => metric.name === name && metric.node === global.node && metric.file === file);
        if (existing) {
            global.logger.log("silly", `during metrics add, metric "${name}" on node "${global.node}" for config "${config}" and file "${file}" was found.`);
            existing.add(v);
        } else {
            global.logger.log("silly", `during metrics add, metric "${name}" on node "${global.node}" for config "${config}" and file "${file}" was created.`);
            const metric = new Metric({
                name: name,
                node: global.node,
                config: config,
                file: file
            });
            metric.add(v);
            this.push(metric);
        }
    }

    public merge(obj: MetricJSON, trim: boolean) {
        const existing = this.find(metric => metric.name === obj.name && metric.node === obj.node && metric.file === obj.file);
        if (existing) {
            if (obj.entries) existing.merge(obj.entries);
            if (trim) existing.trim();
            global.logger.log("silly", `during metrics merge, metric "${obj.name}" on node "${obj.node}" for file "${obj.file}" was found.`);
        } else {
            const metric = new Metric(obj);
            if (obj.entries) {
                for (const dp of obj.entries) {
                    metric.counter += dp.v;
                }
            }
            this.push(metric);
            global.logger.log("silly", `during metrics merge, metric "${obj.name}" on node "${obj.node}" for file "${obj.file}" was created.`);
        }
    }

    /** Offer to custom metrics. */
    public offer(rows: any[], file: string, config: Configuration) {
        if (config.metrics) {

            // add to existing or create if required
            for (const metric of config.metrics) {
                const node = metric.node || global.node;
                const existing = this.find(m => m.name === metric.name && m.node === node && m.file === file);
                if (existing) {
                    existing.offer(rows);
                } else {
                    const created = new Metric(metric);
                    created.node = node;
                    created.config = config.name;
                    created.file = file;
                    this.push(created);
                    created.offer(rows);
                }
            }
    
            // add to volume
            this.add("volume", config.name, file, rows.length);

        }
    }

    private async send(url: string) {
        //if (!this.url) return;
        try {

            // craft the message
            const msg: MetricJSON[] = [];
            for (const metric of this) {
                const entries = metric.uncommitted();
                if (entries && entries.length > 0) {
                    msg.push({
                        name: metric.name,
                        node: metric.node,
                        config: metric.config,
                        file: metric.file,
                        entries: entries
                    });
                }
            }

            // send only if there is data
            if (msg.length > 0) {

                // post the message to the controller
                global.logger.log("verbose", `posting metrics to "${url}"...`);
                await axios.post(url, msg);
                global.logger.log("verbose", `posted metrics to "${url}".`);

                // mark as committed and trim
                for (const sent of msg) {
                    const actual = this.find(metric =>
                        metric.name === sent.name &&
                        metric.node === sent.node &&
                        metric.config === sent.config &&
                        metric.file === sent.file
                    );
                    if (actual && sent.entries) {
                        actual.committed = sent.entries[sent.entries.length - 1].ts;
                        global.logger.log("silly", `metric "${actual.name}" for "${actual.file}" committed to "${actual.committed}".`);
                        actual.trim();
                    }
                }

            }

        } catch (error) {
            // NOTE: metrics do not retry, they will dispatch again in a minute
            global.logger.error("error posting metrics to the controller.");
            global.logger.error(error.stack);
        }
    }

    private expose(statepath: string) {
        this.router = Router();

        // accept metrics
        this.router.post("/:hostname", async (req, res) => {
            try {

                // merge and trim the metrics
                for (const metric of req.body) {
                    this.merge(metric, true);
                }
                global.logger.log("verbose", `merged metrics from "${req.params.hostname}".`);

                // consolidate
                const metricPath = path.join(statepath, `${req.params.hostname}.mtx.json`);
                const filtered = this.filter(metric => metric.node === req.params.hostname);
                const data: {
                    code:    string,
                    metrics: MetricJSON[]
                } = {
                    code:    shortid.generate(),
                    metrics: []
                };
                this.codes[req.params.hostname] = data.code;
                for (const metric of filtered) {
                    data.metrics.push(metric.toJSON());
                }

                // commit to disk
                await this.write(metricPath, data);
                global.logger.log("verbose", `metrics committed to disk as "${metricPath}".`);

                res.status(200).end();
            } catch (error) {
                global.logger.error(error.stack);
                res.status(500).end();
            }
        });

        // prometheus endpoint
        this.router.get("/", (_, res) => {
            try {
                const lines: string[] = [];
                for (const metric of this) {
                    lines.push(`# HELP logagg_${metric.config}_${metric.name}_total A running total of all metrics in config "${metric.config}" and name "${metric.name}".`);
                    lines.push(`# TYPE logagg_${metric.config}_${metric.name}_total counter`);
                    const file = (metric.file) ? `,file="${metric.file}"` : "";
                    lines.push(`logagg_${metric.config}_${metric.name}_total{node="${metric.node}"${file}} ${metric.counter}`);
                }
                res.send(lines.join("\n") + "\n");
            } catch (error) {
                global.logger.error(error.stack);
                res.status(500).end();
            }
        });

        // provide charts by a primary and secondary dimension
        this.router.get("/by/:primary/:secondary/:hostname", (req, res) => {
            try {

                // output
                const charts: Chart[] = [];

                // variables
                const rate = req.query.rate || 15;
                const pointer = moment().utc().startOf("minute");
                const earliest = moment().utc().subtract(3, "days");

                // group by primary
                const grouped = this.groupBy(metric => {
                    if (metric.node !== req.params.hostname) return null;
                    if (req.params.primary === "name") return metric.name;
                    if (req.params.primary === "config") return metric.config;
                    if (req.params.primary === "file") return metric.file;
                    return null;
                });

                // build the charts
                for (const group of grouped) {
                    const series: Series<DataPoint>[] = [];
                    for (const metric of group.values) {
                        let name = "unknown";
                        if (req.params.secondary === "name") name = metric.name;
                        if (req.params.secondary === "config" && metric.config) name = metric.config;
                        if (req.params.secondary === "file" && metric.file) name = metric.file;
                        const listOfDataPoints: DataPoint[] = [];
                        for (const dp of metric) {
                            listOfDataPoints.push(dp);
                        }
                        const existing = series.find(s => s.name === name);
                        if (existing) {
                            existing.data = existing.data.concat(listOfDataPoints);
                        } else {
                            series.push({
                                name: name,
                                data: listOfDataPoints
                            });
                        }
                    }
                    const chart = Metric.chart(series, pointer, earliest, rate);
                    chart.name = group.key;
                    charts.push(chart);
                }

                // respond
                res.send(charts);
            
            } catch (error) {
                global.logger.error(error.stack);
                res.status(500).end();
            }

        });

    }

    /** Since multiple controllers can be used for HA, it is important they stay in sync for metrics.
     *  This method is called whenever a change to a metric file has been discovered so that it can
     *  be read by other controllers */
    private async update(path: string, all: MetricsFileFormat) {
        try {

            // extract the node from the filename
            const match = /(.*\/)?(?<name>.*).mtx.json$/gm.exec(path);
            const node = (match && match.groups && match.groups.name) ? match.groups.name : uuid();

            if (this.codes[node] !== all.code) {
                for (const obj of all.metrics) {
                    this.merge(obj, true);
                }
                global.logger.log("verbose", `merged ${all.metrics.length} metrics from "${path}".`);
            } else {
                global.logger.log("verbose", `ignoring "${path}" because this process generated the file.`);
            }

        } catch (error) {
            global.logger.error(`could not load and parse "${path}".`);
            global.logger.error(error.stack);
        }
    }

    private watchLocal(localfolder: string) {

        // use chokidar to watch
        const metricPath = path.join(localfolder, "*.mtx.json");
        global.logger.log("verbose", `started watching "${metricPath}" for metric files...`);
        const configWatcher = chokidar.watch(metricPath);

        // handle add, change
        configWatcher.on("add", async localpath => {
            const obj = await this.read(localpath) as MetricsFileFormat;
            await this.update(localpath, obj);
        }).on("change", async localpath => {
            const obj = await this.read(localpath) as MetricsFileFormat;
            await this.update(localpath, obj);
        });

    }

    private async watchBlob(url: string, storageKey?: string, storageSas?: string) {

        // instantiate the blob service
        this.instantiateBlob(url, storageKey, storageSas);

        // get a list of all files in the container
        try {
            global.logger.log("verbose", `getting a list of *.mtx.json files from "${url}"...`);
            const list = await this.list(/.+\.mtx\.json$/gm);

            // load each file found
            for (const entry of list) {
                const all = await this.read(entry.name) as MetricsFileFormat;
                await this.update(entry.name, all);
            }
            global.logger.log("verbose", `${list.length} *.mtx.json files found at "${url}".`);

        } catch (ex) {
            global.logger.error(`could not read the list of *.mtx.json files from "${url}".`);
            global.logger.error(ex.stack);
        }

    }

    constructor(obj: MetricsJSON) {
        super();

        // startup depending on the mode
        this.mode = obj.mode;
        switch (this.mode) {
            case "controller":
                if (obj.path) {

                    // expose endpoints
                    this.expose(obj.path);

                    // start watching the metric files
                    if (obj.path) {
                        if (obj.path.startsWith("http://") || obj.path.startsWith("https://")) {
                            this.watchBlob(obj.path, obj.storageKey, obj.storageSas);
                        } else {
                            this.watchLocal(obj.path);
                        }
                    }

                }
                break;

            case "dispatcher":

                // send metrics to a remote controller every minute
                setInterval(_ => {
                    if (obj.url) this.send(obj.url);
                }, 60000);
                break;

        }

    }

}