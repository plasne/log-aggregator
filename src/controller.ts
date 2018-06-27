
// includes
import cmd = require("commander");
import * as winston from "winston";
import express = require("express");
import moment = require("moment");
import * as bodyParser from "body-parser";
import Metrics from "./lib/Metrics";
import Metric, { Chart, DataPoint, Series } from "./lib/Metric";
import Configurations from "./lib/Configurations";
import Checkpoints from "./lib/Checkpoints";

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
const transport = new winston.transports.Console({
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(event => {
            const color = logColors[event.level] || "";
            const level = event.level.padStart(7);
            return `${event.timestamp} ${color}${level}\x1b[0m: ${event.message}`;
        })
    )
})
global.logger = winston.createLogger({
    level: logLevel,
    transports: [ transport ]
});
transport.on("logged", event => {
    // this can cause a recursive loop...
    //   so only allow a minimum standard
    //   so don't accept errors about raising errors
    const minimum = (event.level === "error" || event.level === "warn" || event.level === "info");
    if (minimum && event.config !== "events") {
        const events = configs.find(config => config.name === "events");
        if (events && events.destinations) {
            if (event.file) event.__file = event.file;
            events.destinations.forEach(destination => destination.offer([event]));
        }
    }
});

// log startup
console.log(`Log level set to "${logLevel}".`);
global.logger.log("verbose", `port = "${port}".`);
global.logger.log("verbose", `state = "${state}".`);

// managers (must be after log startup)
const configs: Configurations = new Configurations({
    mode: "controller",
    path: state
});
const checkpoints: Checkpoints = new Checkpoints({
    mode: "controller",
    path: state
});
const metrics:  Metrics        = new Metrics({
    mode: "controller",
    path: state
});

// expose the endpoints
if (configs.router) app.use("/config", configs.router);
if (checkpoints.router) app.use("/checkpoints", checkpoints.router);
if (metrics.router) app.use("/metrics", metrics.router);

// provide summary information for the dashboard
//  NOTE: technically this could be under metrics, but I wanted to reserve the right to show
//        things beyond metrics on the dashboard
app.get("/summary", (req, res) => {
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
        const filtered = metrics.filter(metric => metric.name === "volume" || metric.name === "errors");
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
            if (metric.name === "volume") {
                existing.logsLastHour += metric.sum(hourAgo);
                for (const entry of metric) {
                    volume.data.push(entry);
                }
            }
            if (metric.name === "errors") {
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

// redirect to default web page
app.get("/", (_, res) => {
    res.redirect("/summary.html");
});

// listen for web traffic
app.listen(port, () => {
    global.logger.log("info", `Listening on port ${port}...`);
});