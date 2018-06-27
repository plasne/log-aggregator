
// generates logs to emulate various log formats

// includes
import cmd = require("commander");
import moment = require("moment");
import loremIpsum = require("lorem-ipsum");
import * as fs from "fs";
import * as util from "util";
import * as readline from "readline";

// promisify
const appendFileAsync = util.promisify(fs.appendFile);

// define command line parameters
cmd
    .version("0.1.0");

// generates a random integer between the range (inclusive)
function rand(min: number, max: number) {
    return Math.floor(Math.random() * max) + min;
}

// generates a single message in the "avail" format
function generate_avail(): string {
    const ts = moment().format("YYYY-MM-DD mm:HH:ss,SSS");
    const levels: {
        [index: number]: string
    } = {
        1: " INFO",
        2: " WARN",
        3: "ERROR",
    };
    const level = levels[rand(1, 3)];
    const processes: {
        [index: number]: string
    } = {
        1: "CommServer:TCP:ZZ:1234",
        2: "Hector.me.prettyprint.cassandra.connection.NodeAutoDiscoverService-1",
        3: "RetryService : rrunis1-12d4(1.1.1.1):1157"
    }
    const process = processes[rand(1, 3)];
    const namespaces: {
        [index: number]: string
    } = {
        1: "com.service.net.commserver.impl.SelectorCommServer",
        2: "me.prettyprint.cassandra.connection.HConnectionManager",
        3: "me.prettyprint.cassandra.connection.NodeDiscovery"
    }
    const namespace = namespaces[rand(1, 3)];
    const message = loremIpsum({
        count: 1,
        units: "sentences",
        format: "plain"
    });
    let record = `${ts} ${level} [${process}] ${namespace} - ${message}\n`;
    if (level === "ERROR") {
        const stacktracelines = rand(1, 5);
        for (let i = 0; i < stacktracelines; i++) {
            const stacktrace = loremIpsum({
                count: 1,
                units: "sentences",
                format: "plain"
            });
            record += `! ${stacktrace}\n`;
        }
    }
    return record;
}

function generate_reqeval(): string {
    const ts = moment().format("YYYYMMDD_mm:HH:ss");
    const levels: {
        [index: number]: string
    } = {
        1: "INFO",
        2: "WARN",
        3: "ERROR",
    };
    const level = levels[rand(1, 3)];
    const app = "APP01";
    const packet = rand(100000000, 999999999);
    const hosts: {
        [index: number]: string
    } = {
        1: "zzwill1-11d2/1.1.1.1",
        2: "yyyarn1-13e3/1.1.1.2",
        3: "xxfork1-10q1/1.1.1.3"
    };
    const host = hosts[rand(1, 3)];
    const process = rand(1, 99999);
    const versions: {
        [index: number]: string
    } = {
        1: "2.44.8.1",
        2: "2.45.9.1",
        3: "3.1.1.1"
    };
    const version = versions[rand(1, 3)];
    const summary = loremIpsum({
        count: 1,
        units: "sentences",
        format: "plain"
    });
    let record = `${ts}|${level}|${app}|PacketID:${packet}\n`;
    record += `host:${host}\n`;
    record += `process:${process}\n`;
    record += `version:${version}\n`;
    record += `Summary: ${summary}\n`;
    const odsummaries = rand(1, 12);
    for (let i = 0; i < odsummaries; i++) {
        const odsummary = loremIpsum({
            count: 2,
            units: "words",
            format: "plain"
        });
        record += `ODSummary: ${odsummary}\n`;
    }
    return record + "\n";
}

function formatFunc(format: string): () => string {
    const formats: {
        [index: string]: () => string
    } = {
        "avail": generate_avail,
        "reqeval": generate_reqeval
    };
    const func = formats[format];
    if (!func) throw new Error("You must specify a valid format from this list: avail, reqeval.");
    return func;
}

// action to write a single log entry
cmd
    .command("write <filename> <format>")
    .description("This command lets you write a single log entry to a file.")
    .action(async (filename: string, format: string) => {
        try {
            const line = formatFunc(format)();
            await appendFileAsync(filename, line);
            console.log("1 line written.");
        } catch (error) {
            console.error(error);
        }
    });

// action to start writing log entries
cmd
    .command("start <filename> <format>")
    .description("This command starts writing entries every WRITE_EVERY milliseconds.")
    .option("-e, --write-every <number>", `WRITE_EVERY. Specify the number of milliseconds between writes. Default is "1000" (1 second).`)
    .action(async (filename: string, format: string, opt: any) => {
        const writeEvery = opt.offset || process.env.WRITE_EVERY || 1000;
        let count = 0;
        setInterval(async () => {
            try {
                const line = formatFunc(format)();
                await appendFileAsync(filename, line);
                count++;
                readline.clearLine(process.stdout, 0);
                readline.cursorTo(process.stdout, 0);
                process.stdout.write(`${count} records written to "${filename}".`);
            } catch (error) {
                console.error("\n" + error);
            }
        }, writeEvery);
    });

// parse the command line arguments
cmd.parse(process.argv);
