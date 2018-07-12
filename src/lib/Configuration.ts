
// includes
import moment = require("moment");
import * as chokidar from "chokidar";
import objhash = require("object-hash");
import Destination, { DestinationJSON } from "./Destination";
import { MetricJSON } from "./Metric";

export interface ConfigurationJSON {
    enabled?:      boolean;
    name:          string;
    targets?:      string[];
    sources:       string[];
    breaker?:      string;
    expression?:   string;
    ignore?:       string;
    fields:        string;
    destinations?: DestinationJSON[];
    metrics?:      MetricJSON[];
}

export interface BreakerResult {
    entries:       any;
    extra:         number;
}

export default class Configuration {

    public          hash:            string;
    public          json:            ConfigurationJSON;
    public          path?:           string;
    public readonly enabled:         boolean                   = true;
    public readonly name:            string;
    public readonly targets?:        string[];
    public readonly sources?:        string[];
    public readonly breaker:         string                    = "every-line";
    public readonly expression?:     string;
    public readonly ignore?:         string;
    public readonly fields?:         string;
    public readonly destinations?:   Destination[];
    public readonly metrics?:        MetricJSON[];
    public          watcher?:        chokidar.FSWatcher;

    static get timestampFields() {
        return [ "year", "month", "day", "hour", "hours", "minute", "minutes", "second", "seconds", "ms", "millisecond", "milliseconds" ];
    }

    public isMatch(path: string) {
        if (!this.path) return false;
        const local = this.path.toLowerCase();
        const remote = path.toLowerCase();
        if (local === remote) return true;
        if (local === remote.substr(-local.length)) return true; // sometimes the path might be full or partial
        return false;
    }

    private watch(path: string) {
        if (this.watcher) {
            this.watcher.add(path);
            global.logger.log("debug", `added "${path}" to existing configuration "${this.name}".`);
        } else {
            this.watcher = chokidar.watch(path);
            this.watcher.on("add", path => {
                global.logFiles.notify(path, this);
            }).on("change", path => {
                global.logFiles.notify(path, this);
            }).on("raw", (event, path) => {
                if (event === "moved" || event === "deleted") {
                    global.logFiles.delete(path);
                }
            });
            global.logger.log("debug", `added configuration "${this.name}".`);
        }
        global.logger.log("verbose", `started watching "${path}" based on configuration "${this.name}".`);
    }

    public watchAll() {
        if (this.sources) this.sources.forEach(path => this.watch(path));
    }

    private unwatch(path: string) {
        if (this.watcher) {
            this.watcher.unwatch(path);
            global.logger.log("verbose", `unwatched "${path}" based on configuration "${this.name}".`);
        }
    }

    public unwatchAll() {
        if (this.sources) this.sources.forEach(path => this.unwatch(path));
    }

    /**
     * This method breaks a buffer into entries by looking for blank lines between log entries
     * NOTE: This assumes the start of the buffer is always the start of an entry.
     * NOTE: This assumes unless a blank line is at the end that it might not be the end of an entry.
     * NOTE: This skips any number of blank lines between entries.
     * @param {String} buffer 
     */
    private breakOnBlankLines(buffer: string): BreakerResult {
        const entries = [];
        let entry = "";
        for (const line of buffer.split("\n")) {
            if (line) {
                if (entry) {
                    entry += "\n" + line;
                } else {
                    entry = line;
                }
            } else if (entry) {
                entries.push(entry);
                entry = "";
            }
        }
        return {
            entries: entries,
            extra: entry.length
        };
    }
    
    private breakOnEveryLine(buffer: string): BreakerResult {
        const lines = buffer.split("\n");
        const last = lines.splice(lines.length - 1)[0];
        return {
            entries: lines,
            extra: last.length
        }
    }
    
    private breakOnExpression(buffer: string): BreakerResult {
        if (!this.expression) throw new Error(`config "${this.name}" called breakOnExpression without a defined expression.`);
        const entries = [];
        let entry = "";
        const expression = new RegExp(this.expression, "gm");
        for (const line of buffer.split("\n")) {
            expression.lastIndex = 0; // reset global match flag
            if (expression.test(line)) {
                if (entry) entries.push(entry);
                entry = line;
            } else if (line) {
                if (entry) {
                    entry += "\n" + line;
                } else {
                    entry = line;
                }
            } else {
                if (entry) entries.push(entry);
                entry = "";
            }
        }
        return {
            entries: entries,
            extra: entry.length
        };
    }

    private get breakerFunction(): (buffer: string) => BreakerResult {
        switch (this.breaker.toLowerCase()) {
            case "blank-line":
                return this.breakOnBlankLines;
            case "expression":
                return this.breakOnExpression;
            default:  // every-line
                return this.breakOnEveryLine;
        }
    }

    public bufferToRows(buffer: string, config: string, filename: string): BreakerResult {

        // make sure there is a field breaker
        if (!this.fields) {
            throw new Error(`You must specify a RegExp for "fields" in the config "${this.name}".`);
        }

        // execute the breaker
        const result = this.breakerFunction(buffer);

        // get fields from each row
        const rows = [];
        let errors = 0;
        const ignore: RegExp | null = (this.ignore) ? new RegExp(this.ignore, "gm") : null;
        const fields: RegExp = new RegExp(this.fields, "gm");
        for (const entry of result.entries) {
            if (ignore) ignore.lastIndex = 0; // reset global index
            if (!ignore || !ignore.test(entry)) {
                fields.lastIndex = 0; // reset global index
                const match = fields.exec(entry);
                if (match && match.groups) {
    
                    // resolve the match groups into a new row
                    const row: any = {};
                    for (let rkey in match.groups) {
                        const ikey = rkey.split("_");
                        const lkey = ikey[0];
                        if (!match.groups[rkey]) {
                            // ignore, there is not a value
                        } else if (Configuration.timestampFields.includes(rkey)) {
                            // ignore; the timestamp will be assembled later
                        } else if (ikey.length !== 2) {
                            row[lkey] = match.groups[rkey];
                        } else if (row[lkey]) {
                            row[lkey].push(match.groups[rkey]);
                        } else {
                            row[lkey] = [ match.groups[rkey] ];
                        }
                    }
            
                    //match.groups.year = Number.parseInt(match.groups.year);

                    // construct the timestamp from the timestamp fields
                    const now = moment();
                    row.timestamp = moment()
                    .year(Number.parseInt(match.groups.year) || now.year())
                    .month(Number.parseInt(match.groups.month) - 1 || now.month()) // months are 0-indexed in moment
                    .date(Number.parseInt(match.groups.day) || now.date())
                    .hour(Number.parseInt(match.groups.hour) || Number.parseInt(match.groups.hours) || now.hour())
                    .minute(Number.parseInt(match.groups.minute) || Number.parseInt(match.groups.minutes) || now.minute())
                    .second(Number.parseInt(match.groups.second) || Number.parseInt(match.groups.seconds) || now.second())
                    .millisecond(Number.parseInt(match.groups.ms) || Number.parseInt(match.groups.millisecond) || Number.parseInt(match.groups.milliseconds) || 0)
                    .format("YYYY-MM-DDTHH:mm:ss") + "Z"; // ISO-8601
    
                    // add the system fields
                    row.__raw = entry;
                    row.__file = filename;
    
                    // commit the row
                    rows.push(row);
    
                } else {
                    const level = (errors === 0) ? "error" : "warn";
                    global.logger.log(level, `config "${this.name}" fields RegExp couldn't parse "${entry}".`, {
                        config: config,
                        file:   filename
                    });
                    errors++;
                }
            } else {
                global.logger.log("verbose", `config "${this.name}" ignored "${entry}".`);
            }
        }

        // log additional errors
        if (errors > 1) {
            global.logger.error(`${errors} total entries could not be parsed by the fields RegExp for config "${this.name}".`, {
                config: config,
                file:   filename
            });
        }

        // return the rows and the extra
        //  NOTE: the extra is what was read beyond the last delimiter
        return {
            entries: rows,
            extra: result.extra
        }

    }

    /** This should be called before releasing all references to the Configuration. */
    public dispose() {
        global.logger.log("silly", `configuration "${this.name}" was disposed.`);
        if (this.sources) this.sources.forEach(path => this.unwatch(path));
        if (this.destinations) this.destinations.forEach(d => d.dispose());
    }

    constructor(obj: ConfigurationJSON, prior?: Configuration) {

        // compute the hash
        //  NOTE: this is used to determine if a new configuration is provided on a refresh
        this.hash = objhash(obj);
        this.json = obj;
        
        // properties
        if (obj.enabled !== undefined) this.enabled = obj.enabled;
        this.name = obj.name;
        if (obj.targets) this.targets = obj.targets;
        this.sources = obj.sources;
        if (obj.breaker) this.breaker = obj.breaker;
        if (obj.expression) this.expression = obj.expression;
        if (obj.ignore) this.ignore = obj.ignore;
        this.fields = obj.fields;

        // destinations
        if (obj.destinations) {
            this.destinations = [];
            for (const destination of obj.destinations) {
                if (prior && prior.destinations) {
                    const existing = prior.destinations.find(d => d.isSame(destination));
                    if (existing) {
                        this.destinations.push(existing);
                        global.logger.log("debug", `in config "${this.name}" destination "${destination.name}" was reused.`);
                    } else {
                        this.destinations.push( new Destination(this, destination) );
                        global.logger.log("debug", `in config "${this.name}" destination "${destination.name}" was created.`);
                    }
                } else {
                    this.destinations.push( new Destination(this, destination) );
                    global.logger.log("debug", `in config "${this.name}" destination "${destination.name}" was created.`);
                }
            }
        }

        // metrics
        if (obj.metrics) this.metrics = obj.metrics;

    }

}

