

// includes
import cmd = require("commander");
import * as winston from "winston";
import { promises as fsp } from "fs";
import express = require("express");
import * as chokidar from "chokidar";
import moment = require("moment");
import * as bodyParser from "body-parser";
import { v4 as uuid } from "uuid";
import shortid = require("shortid");
import Metrics from "./lib/Metrics";
import Metric, { Chart, MetricJSON, DataPoint, Series } from "./lib/Metric";
import Events from "./lib/Events";
import Configurations from "./lib/Configurations";

// prototype extensions
require("./lib/String.prototype.combineAsPath.js");
require("./lib/Array.prototype.groupBy.js");

// startup express
const app = express();
app.use(express.static("web"));
app.use(bodyParser.json({
    limit: "50mb"
}));

// define command line parameters
cmd
    .version("0.1.0")
    .option("-l, --log-level <string>", `LOG_LEVEL. The minimum level to log to the console (error, warn, info, verbose, debug, silly). Defaults to "error".`, /^(error|warn|info|verbose|debug|silly)$/i)
    .option("-p, --port <integer>", `PORT. The port to host the web services on. Defaults to "8080".`, parseInt)
    .option("-s, --state-path <string>", `STATE_PATH. The path to all files mananging current state. Defaults to "./state".`)
    .parse(process.argv);

// locals
const logLevel: string         = cmd.logLevel   || process.env.LOG_LEVEL           || "error";
const port:     number         = cmd.port       || process.env.PORT                || 8080;
const state:    string         = cmd.statePath  || process.env.STATE_PATH          || "./state";
const configs:  Configurations = new Configurations();
const metrics:  Metrics        = new Metrics();
const events:   Events         = new Events();

// enable logging
const logColors: {
    [index: string]: string
} = {
    "error":   "\x1b[31m", // red
    "warn":    "\x1b[33m", // yellow
    "info":    "",         // white
    "verbose": "\x1b[32m", // green
    "debug":   "\x1b[32m", // green
    "silly":   "\x1b[32m"  // green
};
global.logger = winston.createLogger({
    level: logLevel,
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(event => {
                    const color = logColors[event.level] || "";
                    const level = event.level.padStart(7);
                    return `${event.timestamp} ${color}${level}\x1b[0m: ${event.message}`;
                })
            )
        })
    ]
});

// log startup
console.log(`Log level set to "${logLevel}".`);
global.logger.log("verbose", `port = "${port}".`);
global.logger.log("verbose", `state = "${state}".`);

// update the config
//  TODO: move under Configurations class once file handler is in place
async function updateConfig(path: string) {
    try {
        global.logger.log("verbose", `loading "${path}"...`);
        const raw = await fsp.readFile(path, {
            encoding: "utf8"
        });
        const obj = JSON.parse(raw);
        const match = /^(.*)\/(?<filename>.*)$/.exec(path);
        obj.name = (match && match.groups) ? match.groups.filename : uuid();
        const index = configs.findIndex(config => config.name === obj.name);
        if (index < 0) {
            configs.push(obj);
            global.logger.log("verbose", `loaded "${path}".`);
        } else {
            configs[index] = obj;
            global.logger.log("verbose", `updated "${path}".`);
        }
    } catch (error) {
        global.logger.error(`could not load and parse "${path}".`);
        global.logger.error(error.stack);
    }
}

// read the config files
const configPath = state.combineAsPath("*.cfg.json");
global.logger.log("verbose", `started watching "${configPath}" for configuration files...`);
const configWatcher = chokidar.watch(configPath);
configWatcher.on("add", path => {
    updateConfig(path);
}).on("change", async path => {
    updateConfig(path);
});

// provide config files if asked
app.get("/config/:hostname", (req, res) => {
    try {

        // asking
        global.logger.log("verbose", `"${req.params.hostname}" is asking for configs...`);

        // filter to those appropriate for the host
        const filtered = configs.filter(config => {
            if (config.enabled === false) return false;
            return true;
        });

        // return the configurations
        global.logger.log("verbose", `"${req.params.hostname}" received ${filtered.length} configs.`);
        res.send(filtered);

    } catch (error) {
        global.logger.error(error.stack);
        res.status(500).end();
    }
});

// provide checkpoints if asked
app.get("/checkpoints/:hostname", async (req, res) => {
    try {

        // asking
        global.logger.log("verbose", `"${req.params.hostname}" is asking for checkpoints...`);
        const checkpointsPath = state.combineAsPath(`${req.params.hostname}.chk.json`);
        global.logger.log("debug", `looking for checkpoint file "${checkpointsPath}"...`);

        // read the checkpoint file
        try {
            const raw = await fsp.readFile(checkpointsPath, "utf8");
            const obj = JSON.parse(raw);
            global.logger.log("verbose", `"${req.params.hostname}" was given the checkpoint file.`);
            global.logger.log("debug", raw);
            res.send(obj);
        } catch (error) {
            if (error.code === "ENOENT") { // file doesn't exist
                global.logger.log("verbose", `"${req.params.hostname}" was informed there were no checkpoints.`);
                res.send([]); // send an empty checkpoint file, but it's a 200
            } else {
                throw error;
            }
        }

    } catch (error) {
        global.logger.error(error.stack);
        res.status(500).end();
    }
});

// accept checkpoints
app.post("/checkpoints/:hostname", async (req, res) => {
    try {

        // write the checkpoints
        const checkpointsPath = state.combineAsPath(`${req.params.hostname}.chk.json`);
        try {
            global.logger.log("verbose", `writing checkpoint file "${checkpointsPath}"...`);
            await fsp.writeFile(checkpointsPath, JSON.stringify(req.body));
            global.logger.log("verbose", `wrote checkpoint file "${checkpointsPath}".`);
        } catch (error) {
            global.logger.error(`error writing checkpoint file "${checkpointsPath}".`);
            global.logger.error(error.stack);
        }
        res.status(200).end();

    } catch (error) {
        global.logger.error(error.stack);
        res.status(500).end();
    }
});

// accept metrics
app.post("/metrics/:hostname", async (req, res) => {
    try {

        // merge and trim the metrics
        for (const metric of req.body) {
            metrics.merge(metric, true);
        }
        global.logger.log("verbose", `merged metrics from "${req.params.hostname}".`);

        // commit to disk
        const metricPath = state.combineAsPath(`${req.params.hostname}.mtx.json`);
        const filtered = metrics.filter(metric => metric.node === req.params.hostname);
        const data: {
            code:    string,
            metrics: MetricJSON[]
        } = {
            code:    shortid.generate(),
            metrics: []
        };
        metrics.codes[req.params.hostname] = data.code;
        for (const metric of filtered) {
            data.metrics.push(metric.toJSON());
        }
        await fsp.writeFile(metricPath, JSON.stringify(data));
        global.logger.log("verbose", `metrics committed to disk as "${metricPath}".`);

        res.status(200).end();
    } catch (error) {
        global.logger.error(error.stack);
        res.status(500).end();
    }
});

// accept events
app.post("/events/:hostname", async (req, res) => {
    try {

        // merge and trim the events
        for (const event of req.body) {
            events.push(event);
            events.trim();
        }
        global.logger.log("verbose", `merged ${req.body.length} events from "${req.params.hostname}".`);

        // commit to disk
        const filtered = events.filter(event => event.node === req.params.hostname);
        const eventsPath = state.combineAsPath(`${req.params.hostname}.evt.json`);
        await fsp.writeFile(eventsPath, JSON.stringify(filtered));
        global.logger.log("verbose", `events committed to disk as "${eventsPath}".`);

        res.status(200).end();
    } catch (error) {
        global.logger.error(error.stack);
        res.status(500).end();
    }
});

// update the metrics
//  TODO: move under Metrics class once file handler is in place
async function updateMetrics(path: string) {
    try {
        global.logger.log("verbose", `loading "${path}"...`);
        const match = /^(.*)\/(?<node>.*)\.mtx\.json$/.exec(path);
        if (match && match.groups && match.groups.node) {
            const raw = await fsp.readFile(path, "utf8");
            const data: {
                code:    string,
                metrics: MetricJSON[]
            } = JSON.parse(raw);
            if (metrics.codes[match.groups.node] !== data.code) {
                for (const obj of data.metrics) {
                    metrics.merge(obj, true);
                }
                global.logger.log("verbose", `merged ${data.metrics.length} metrics from "${path}".`);
            } else {
                global.logger.log("verbose", `ignoring "${path}" because this process generated the file.`);
            }
        }
    } catch (error) {
        global.logger.error(`could not load and parse "${path}".`);
        global.logger.error(error.stack);
    }
}

// read the metrics files
const metricPath = state.combineAsPath("*.mtx.json");
global.logger.log("verbose", `started watching "${metricPath}" for metric files...`);
const metricWatcher = chokidar.watch(metricPath);
metricWatcher.on("add", path => {
    updateMetrics(path);
}).on("change", async path => {
    updateMetrics(path);
});

app.get("/summary", async (req, res) => {
    try {

        // summary
        interface node {
            name: string,
            logsLastHour: number,
            errorsLastHour: number
        }
        const summary = {
            nodes: [] as node[],
            chart: undefined as Chart | undefined
        };
        
        // collect info on metrics
        const hourAgo = moment().subtract(1, "hour");
        const volume: Series<DataPoint> = {
            name: "volume",
            data: []
        };
        const errors: Series<DataPoint> = {
            name: "errors",
            data: []
        };
        const filtered = metrics.filter(metric => metric.name === "__volume" || metric.name === "__error");
        for (const metric of filtered) {
            let existing = summary.nodes.find(node => node.name === metric.node);
            if (!existing) {
                existing = {
                    name: metric.node,
                    logsLastHour: 0,
                    errorsLastHour: 0
                };
                summary.nodes.push(existing);
            }
            if (metric.name === "__volume") {
                existing.logsLastHour += metric.sum(hourAgo);
                for (const entry of metric) {
                    volume.data.push(entry);
                }
            }
            if (metric.name === "__error") {
                existing.errorsLastHour += metric.sum(hourAgo);
                for (const entry of metric) {
                    errors.data.push(entry);
                }
            }
        }

        // chart for volume & error data
        const rate = req.query.rate || 15;
        const pointer = moment().utc().startOf("minute");
        const earliest = moment().utc().subtract(3, "days");
        summary.chart = Metric.chart([ volume, errors], pointer, earliest, rate);
        
        // respond
        res.send(summary);

    } catch (error) {
        global.logger.error(error.stack);
        res.status(500).end();
    }
});

app.get("/by-:dimension/:hostname", async (req, res) => {
    try {

        // output
        const charts: Chart[] = [];

        // variables
        const rate = req.query.rate || 15;
        const pointer = moment().utc().startOf("minute");
        const earliest = moment().utc().subtract(3, "days");

        // group by dimension
        const grouped = metrics.groupBy(metric => {
            if (metric.node !== req.params.hostname) return null;
            if (req.params.dimension === "name") return metric.name;
            if (req.params.dimension === "file") return metric.file;
            return null;
        });

        // build the charts
        for (const group of grouped) {
            const series: Series<DataPoint>[] = [];
            for (const metric of group.values) {
                let name = "unknown";
                if (req.params.dimension === "name" && metric.file) name = metric.file;
                if (req.params.dimension === "file") name = metric.name;
                series.push({
                    name: name,
                    data: metric
                });
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

// redirect to default web page
app.get("/", (_, res) => {
    res.redirect("/summary.html");
});

// listen for web traffic
app.listen(port, () => {
    global.logger.log("info", `Listening on port ${port}...`);
});