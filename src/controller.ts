

// includes
import cmd = require("commander");
import * as winston from "winston";
import * as fs from "fs";
import express = require("express");
import * as chokidar from "chokidar";
import moment = require("moment");
import * as util from "util";
import * as bodyParser from "body-parser";
import { v4 as uuid } from "uuid";
import Metrics from "./lib/Metrics";
import Metric, { Chart } from "./lib/Metric";
import Events from "./lib/Events";
import Configurations from "./lib/Configurations";

// prototypes
require("./lib/String.prototype.combineAsPath.js");

// promisify
const statAsync = util.promisify(fs.stat);
const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

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
async function updateConfig(path: string) {
    try {
        global.logger.log("verbose", `loading "${path}"...`);
        const raw = await readFileAsync(path, {
            encoding: "utf8"
        });
        const obj = JSON.parse(raw);
        const match = /^(.*)[/](?<filename>.*)$/.exec(path);
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
            await statAsync(checkpointsPath);
            const raw = await readFileAsync(checkpointsPath, "utf-8");
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
            // TODO: renable checkpointing
            //writeFileAsync(checkpointsPath, JSON.stringify(req.body));
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
        const names: Array<string> = [];
        for (const metric of req.body) {
            metrics.merge(metric, true);
            names.push(metric.name);
        }
        global.logger.log("verbose", `merged metrics from "${req.params.hostname}".`);

        // commit to disk
        const filtered = metrics.filter(metric => metric.node === req.params.hostname && names.includes(metric.name));
        for (const metric of filtered) {
            const metricsPath = state.combineAsPath(`${req.params.hostname}.${metric.name}.mtx.json`);
            writeFileAsync(metricsPath, JSON.stringify(metric));
            global.logger.log("verbose", `metrics committed to disk as "${metricsPath}".`);
        }

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
        writeFileAsync(eventsPath, JSON.stringify(filtered));
        global.logger.log("verbose", `events committed to disk as "${eventsPath}".`);

        res.status(200).end();
    } catch (error) {
        global.logger.error(error.stack);
        res.status(500).end();
    }
});

app.get("/metrics", (_, res) => {

    for (const metric of metrics) {
        let total = 0;
        for (const entry of metric) {
            total += entry.v;
        }
        console.log(`${metric.name} from ${metric.node} for ${metric.file}: ${total}`);
    }
    res.status(200).end();

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
            nodes: [] as Array<node>,
            volume: undefined as Chart | undefined
        };
        
        // collect info on metrics
        const volume = [];
        for (const metric of metrics) {
            const existing = summary.nodes.find(node => node.name === metric.node);
            if (!existing) {
                summary.nodes.push({
                    name: metric.node,
                    logsLastHour: 0,
                    errorsLastHour: 0
                });
            }
            for (const entry of metric) {
                volume.push(entry);
            }
        }

        // chart for volume data
        const rate = req.query.rate || 15;
        const pointer = moment().utc().startOf("minute");
        const earliest = moment().utc().subtract(3, "days");
        summary.volume = Metric.chart(volume, pointer.clone(), earliest, rate);
        
        // respond
        res.send(summary);

    } catch (error) {
        global.logger.error(error.stack);
        res.status(500).end();
    }
});

// redirect to default web page
app.get("/", (_, res) => {
    res.redirect("/default.html");
});

// listen for web traffic
app.listen(port, () => {
    global.logger.log("info", `Listening on port ${port}...`);
});