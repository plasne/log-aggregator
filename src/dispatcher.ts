
// includes
import cmd = require("commander");
import * as winston from "winston";
import * as os from "os";
import * as util from "util";
import Checkpoints from "./lib/Checkpoints";
import Configurations from "./lib/Configurations";
import LogFiles from "./lib/LogFiles";
import Metrics from "./lib/Metrics";

// prototypes
require("./lib/String.prototype.combineAsPath.js");
require("./lib/Array.prototype.remove.js");

// promisify
const delay = util.promisify(setTimeout);

// define command line parameters
cmd
    .version("0.1.0")
    .option("-l, --log-level <string>", `LOG_LEVEL. The minimum level to log to the console (error, warn, info, verbose, debug, silly). Defaults to "error".`, /^(error|warn|info|verbose|debug|silly)$/i)
    .option("-n, --node-name <string>", `DISPATCHER_NAME. The *unique* name that will be recorded for this dispatcher. Defaults to the system's hostname.`)
    .option("-u, --url <string>", `CONTROLLER_URL. The URL of the controller(s). This is REQUIRED.`)
    .option("-i, --interval <integer>", `CONTROLLER_INTERVAL. The number of milliseconds between each call to the controller to get configuration changes. Defaults to "60000" (1 minute).`, parseInt)
    .option("-c, --chunk-size <integer>", `CHUNK_SIZE. The max number of KBs that are read from a log file at a time. Higher levels mean more is kept in memory. Defaults to "5000" (5 MB).`, parseInt)
    .option("-b, --batch-size <integer>", `BATCH_SIZE. The application will wait on the batch size or an interval before sending records. Defaults to "100".`, parseInt)
    .parse(process.argv);

// locals
const logLevel: string   = cmd.logLevel   || process.env.LOG_LEVEL           || "error";
const url:      string   = cmd.url        || process.env.CONTROLLER_URL;
const interval: number   = cmd.interval   || process.env.CONTROLLER_INTERVAL || 60000;

// globals
global.node           = cmd.nodeName   || process.env.DISPATCHER_NAME     || os.hostname();
global.chunkSize      = cmd.chunkSize  || process.env.CHUNK_SIZE          || 5000;
global.batchSize      = cmd.batchSize  || process.env.BATCH_INTERVAL      || 100;

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
        const events = global.configurations.find(config => config.name === "events");
        if (events && events.destinations) {
            if (event.file) event.__file = event.file;
            events.destinations.forEach(destination => destination.offer([event]));
        }
    }
});

// log startup
console.log(`Log level set to "${logLevel}".`);
global.logger.log("verbose", `Dispatcher name = "${global.node}".`);
if (!url) throw new Error("You must specify a controller URL to run this application.");
global.logger.log("verbose", `Controller URL = "${url}".`);
global.logger.log("verbose", `Controller interval = "${interval}".`);

// managers (must be after log startup)
global.checkpoints    = new Checkpoints({
    mode: "dispatcher",
    url:  url.combineAsPath("checkpoints/", global.node)
});
global.configurations = new Configurations({
    mode: "dispatcher",
    url:  url.combineAsPath("config/", global.node)
});
global.logFiles       = new LogFiles();
global.metrics        = new Metrics({
    mode: "dispatcher",
    url:  url.combineAsPath("metrics/", global.node)
});

// startup
(async () => {

    // keep trying the startup until successful
    do {

        // get the checkpoints from the controller
        await global.checkpoints.fetch();

        // if successful, get the configuration from the controller
        // if unsuccessful, try again after the interval
        if (global.checkpoints.isInitialized) {
            setInterval(() => {
                global.configurations.refresh();
            }, interval);
            global.configurations.refresh();
        } else {
            await delay(interval);
        }

    } while (!global.checkpoints.isInitialized);

})();
