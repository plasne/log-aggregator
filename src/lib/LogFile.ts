
// includes
import * as fs from "fs";
import * as util from "util";
import Configuration from "./Configuration.js";
import Checkpoint from "./Checkpoint";
import Destination from "./Destination";

// promisify
const statAsync = util.promisify(fs.stat);

export default class LogFile {

    public path:          string;
    public configuration: Configuration;

    private handle: NodeJS.Timer | null = null;

    public get isBusy(): boolean {
        return (this.handle != null);
    }

    read() {

        // if the file is already being read (or scheduled to be read), abort
        if (this.isBusy) {
            global.logger.log("silly", `an attempt to read "${this.path}" found the reader busy (abort).`);
            return;
        };

        // function to offer all rows to each destination
        const offer = (buffer: string, checkpoints: Checkpoint[], destinations: Destination[], pointer: number) => {

            // convert to rows
            const rows = this.configuration.bufferToRows(buffer, this.path);
            global.logger.log("silly", `bufferToRows on "${this.path}" resulted in ${rows.entries.length} rows and ${rows.extra} extra bytes.`);
            if (rows.entries.length < 1) return;

            // offer to each destination
            for (const checkpoint of checkpoints) {
                const destination = destinations.find(destination => destination.name === checkpoint.destination);
                if (destination) {
                    global.logger.log("debug", `on read of "${this.path}", ${rows.entries.length} records were offered to "${destination.name}".`);
                    destination.offer(rows.entries, checkpoint, (pointer - rows.extra));
                }
            }

            // offer for use in custom metrics
            global.metrics.offer(rows.entries, this.path, this.configuration);

        }

        // function to do the work of read, could be looped several times
        const action = async () => {
            try {
                global.logger.log("debug", `start reading "${this.path}"...`);

                // find all destinations that are ready
                const destinations = this.configuration.destinations || [];
                const ready = destinations.filter(destination => !destination.isBusy);
                global.logger.log("silly", `${ready.length} destinations are "ready".`);
                if (ready.length < 1) {
                    global.logger.log("debug", `on read of "${this.path}", all destinations were busy (defer).`);
                    this.handle = setTimeout(_ => { action(); }, 1000); // defer 1 second
                    return;
                }

                // get the checkpoints
                const checkpoints = global.checkpoints.byPathAndDestination(this.path, ready);
                global.logger.log("silly", `${checkpoints.length} checkpoints were found by path and destination.`);

                // reset any checkpoints that aren't valid
                const stats = await statAsync(this.path);
                for (const checkpoint of checkpoints) {
                    if (checkpoint.ino !== stats.ino || checkpoint.buffered > stats.size) {
                        global.logger.log("debug", `on read of "${this.path}", checkpoint for "${checkpoint.destination}" was reset.`);
                        checkpoint.ino = stats.ino;
                        checkpoint.committed = 0;
                        checkpoint.buffered = 0;
                    }
                }

                // additional logging
                if (global.logger.level === "silly") {
                    for (const checkpoint of checkpoints) {
                        global.logger.log("silly", `checkpoint "${checkpoint.path}" to "${checkpoint.destination}" is buffered to ${checkpoint.buffered} vs. max of ${stats.size - 1}.`);
                    }
                }

                // filter out any checkpoints that are at the end of the file
                const outstanding = checkpoints.filter(checkpoint => checkpoint.buffered < stats.size - 1);
                if (outstanding.length > 0) {
                    global.logger.log("debug", `on read of "${this.path}", ${outstanding.length} checkpoints are outstanding.`);
                    for (const checkpoint of outstanding) {
                        global.logger.log("silly", `on read of "${this.path}", ${checkpoint.destination} is outstanding.`);
                    }
                } else {
                    if (ready.length < destinations.length) {
                        global.logger.log("debug", `on read of "${this.path}", all destinations that need reads are busy (defer).`);
                        this.handle = setTimeout(_ => { action(); }, 1000); // defer 1 second
                    } else {
                        global.logger.log("debug", `on read of "${this.path}", all checkpoints are at end of file (done).`);
                        this.handle = null; // there is nothing left to do
                    }
                    return;
                }

                // find all checkpoints that are the same
                const pointer = outstanding[0].buffered;
                const same = checkpoints.filter(checkpoint => checkpoint.buffered === pointer);

                // ensure there is a limit to how much is read
                const max = global.chunkSize * 1000;
                let end = stats.size - 1;
                if (end - pointer > max) end = pointer + max;

                // read the section of the file
                let buffer = "";
                fs.createReadStream(this.path, {
                    start: pointer,
                    end: end
                }).on("data", data => {
                    buffer += data;
                }).on("end", () => {
                    offer(buffer, same, ready, end);
                    this.handle = setTimeout(_ => { action(); }, 0); // read again in case there is more
                }).on("error", error => {
                    
                    // try again in a bit
                    global.logger.error(`on read of "${this.path}", recovery from the error will be attempted (defer).`);
                    global.logger.error(error.stack);
                    this.handle = setTimeout(_ => { action(); }, 1000);

                });

            } catch (error) {
                // clean this up
                global.logger.error("error in LogFile.read().action().");
                global.logger.error(error.stack);
                this.handle = setTimeout(_ => { action(); }, 1000);
            }
        }

        // kick off the read action immediately
        this.handle = setTimeout(_ => { action(); }, 0); // this makes the reader busy

    }

    constructor(path: string, configuration: Configuration) {
        this.path = path;
        this.configuration = configuration;
    }
}
