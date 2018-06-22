
// includes
import axios from "axios";
import Metric, { MetricJSON } from "./Metric.js";
import Configuration from "./Configuration.js";

export default class Metrics extends Array<Metric> {

    public readonly url?: string;

    /* Stores the last code generated for metrics received from a node. */
    public codes: {
        [node: string]: string
    } = {};

    add(name: string, file: string, v: number) {
        const existing = this.find(metric => metric.name === name && metric.node === global.node && metric.file === file);
        if (existing) {
            global.logger.log("silly", `during metrics add, metric "${name}" on node "${global.node}" for file "${file}" was found.`);
            existing.add(v);
        } else {
            global.logger.log("silly", `during metrics add, metric "${name}" on node "${global.node}" for file "${file}" was created.`);
            const metric = new Metric({
                name: name,
                node: global.node,
                file: file
            });
            metric.add(v);
            this.push(metric);
        }
    }

    merge(obj: MetricJSON, trim: boolean) {
        const existing = this.find(metric => metric.name === obj.name && metric.node === obj.node && metric.file === obj.file);
        if (existing) {
            if (obj.entries) existing.merge(obj.entries);
            if (trim) existing.trim();
            global.logger.log("silly", `during metrics merge, metric "${obj.name}" on node "${obj.node}" for file "${obj.file}" was found.`);
        } else {
            const metric = new Metric({
                name: obj.name,
                node: obj.node,
                file: obj.file
            });
            if (obj.entries) {
                for (const entry of obj.entries) {
                    metric.push(entry);
                }
            }
            this.push(metric);
            global.logger.log("silly", `during metrics merge, metric "${obj.name}" on node "${obj.node}" for file "${obj.file}" was created.`);
        }
    }

    /** Offer to custom metrics. */
    offer(rows: any[], file: string, config: Configuration) {
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
                    created.file = file;
                    this.push(created);
                    created.offer(rows);
                }
            }
    
            // add to volume
            this.add("__volume", file, rows.length);

        }
    }

    async send() {
        if (!this.url) return;
        try {

            // craft the message
            const msg = [];
            for (const metric of this) {
                const entries = metric.uncommitted();
                if (entries && entries.length > 0) {
                    msg.push({
                        name: metric.name,
                        node: metric.node,
                        file: metric.file,
                        entries: entries
                    });
                }
            }

            // send only if there is data
            if (msg.length > 0) {

                // post the message to the controller
                global.logger.log("verbose", `posting metrics to "${this.url}"...`);
                await axios.post(this.url, msg);
                global.logger.log("verbose", `posted metrics to "${this.url}".`);

                // mark as committed and trim
                for (const sent of msg) {
                    const actual = this.find(metric => metric.name === sent.name && metric.node === sent.node && metric.file === sent.file);
                    if (actual) {
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

    constructor(url?: string) {
        super();

        // if a URL is present, record it and send to it every minute
        if (url) {
            this.url = url;
            setInterval(_ => { this.send(); }, 60000);
        }

    }

}