
// includes
import axios from "axios";
import moment = require("moment");
import { createHmac } from "crypto";
import Testable, { TestableJSON } from "./Testable";
import Checkpoint from "./Checkpoint";
import Configuration from "./Configuration";

// TODO: make these configurable
const dispatchEvery = 10000;
const tryAfter = 10000;

type connector = "auto" | "LogAnalytics" | "URL";

export interface DestinationJSON extends TestableJSON {
    name:           string,
    connector?:     connector,
    url?:           string,
    workspaceId?:   string,
    workspaceKey?:  string,
    logType?:       string
}

export default class Destination extends Testable {

    public config:        Configuration;
    public name:          string;
    public connector?:    connector;
    public url?:          string;
    public workspaceId?:  string;
    public workspaceKey?: string;
    public logType?:      string;
    public buffer:        any[]         = [];
    public handle?:       NodeJS.Timer;
    public dispatcher?:   NodeJS.Timer;

    get isBusy() {
        return (this.handle);
    }

    public isSame(other: DestinationJSON) {
        if (this.name !== other.name) return false;
        if (this.connector !== other.connector) return false;
        if (this.url !== other.url) return false;
        if (this.workspaceId !== other.workspaceId) return false;
        if (this.workspaceKey !== other.workspaceKey) return false;
        if (this.logType !== other.logType) return false;
        return true;
    }

    public offer(rows: any[], checkpoint?: Checkpoint, pointer?: number) {
        
        // record the last offered pointer, this ensures that even if the buffers contain
        //  undispatched records, the same block isn't read from the file again
        if (checkpoint && pointer) checkpoint.buffered = pointer;

        // filter
        const filtered = rows.filter(row => {
            if (!this.testAnd(row)) return false;
            if (!this.testOr(row)) return false;
            if (!this.testNot(row)) return false;
            return true;
        });
        global.logger.log("debug", `${filtered.length} of ${rows.length} rows were accepted by "${this.name}".`);

        // add the new rows to the buffer
        for (const row of filtered) {
            this.buffer.push(row);
        }

        // either commit the checkpoint immediately or if there is a buffer, put it at the end
        if (checkpoint && pointer) {
            if (this.buffer.length < 1) {
                checkpoint.committed = pointer;
                global.logger.log("debug", `the checkpoint path "${checkpoint.path}" to "${checkpoint.destination}" committed to "${checkpoint.committed}".`);
            } else {
                this.buffer.push({
                    __checkpoint: checkpoint,
                    __pointer: pointer
                });
            }
        }

        // log
        global.logger.log("silly", `after the offer to "${this.name}", the buffer holds ${this.buffer.length} records (includes checkpoints).`);

        /*
        if (this.config.name === "events") {
            console.log(rows);
            throw new Error("stop here");
        }
        */

        // dispatch if buffer size is reached
        if (this.buffer.length >= global.batchSize) this.dispatch();

    }

    private postToLogAnalytics(batch: any[]) {

        // check for the required fields
        if (!this.workspaceId || !this.workspaceKey || !this.logType) {
            throw new Error(`destination "${this.name}" does not have a valid configuration to dispatch messages to.`);
        }

        // log
        global.logger.log("verbose", `posting ${batch.length} records to "${this.name}"...`);
        global.logger.log("silly", `"${this.name}" is sending to Log Analytics workspace "${this.workspaceId}".`);

        // change the timestamp to ISO-8601
        for (const row of batch) {
            row.timestamp = moment(row.timestamp).utc().format("YYYY-MM-DDTHH:mm:ss") + "Z";
        }

        // create the signature
        const ts = moment().utc().format("ddd, DD MMM YYYY HH:mm:ss ") + "GMT"; // RFC-1123
        const payload = JSON.stringify(batch);
        const len = Buffer.byteLength(payload);
        const code = `POST\n${len}\napplication/json\nx-ms-date:${ts}\n/api/logs`;
        const hmac = createHmac("sha256", Buffer.from(this.workspaceKey, "base64"));
        const signature = hmac.update(code, "utf8").digest("base64");

        // post
        return axios({
            method: "post",
            url: `https://${this.workspaceId}.ods.opinsights.azure.com/api/logs?api-version=2016-04-01`,
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Log-Type": this.logType,
                "x-ms-date": ts,
                "time-generated-field": "timestamp",
                "Authorization": `SharedKey ${this.workspaceId}:${signature}`
            },
            data: payload
        });
        /*
        return new Promise((resolve, reject) => {
            request.post({
                uri: `https://${workspace_id}.ods.opinsights.azure.com/api/logs?api-version=2016-04-01`,
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Log-Type": log_type,
                    "x-ms-date": ts,
                    "time-generated-field": timestamp_field,
                    "Authorization": `SharedKey ${workspace_id}:${signature}`
                },
                body: payload
            }, (error, response, body) => {
                if (!error && response.statusCode >= 200 && response.statusCode <= 299) {
                    resolve();
                } else if (error) {
                    reject(error);
                } else {
                    reject(new Error(`${response.statusCode}: ${response.statusMessage}`));
                }
            });
        });
        */

    }

    private postToURL(batch: any[]) {

        // check for the required fields
        if (!this.url) {
            throw new Error(`destination "${this.name}" does not have a valid configuration to dispatch messages to.`);
        }
        
        // log
        global.logger.log("verbose", `posting ${batch.length} records to "${this.name}"...`);
        global.logger.log("silly", `"${this.name}" resolves to "${this.url}".`);

        // post
        return axios.post(this.url, batch);

    }

    private post(batch: any[]) {
        if (this.workspaceId && this.workspaceKey && this.logType) {
            return this.postToLogAnalytics(batch);
        } else if (this.url) {
            return this.postToURL(batch);
        } else {
            throw new Error(`destination "${this.name}" does not have a valid configuration to dispatch messages to.`);
        }
    }

    private get connectorFunction(): (batch: any[]) => void {
        switch ((this.connector || "auto").toLowerCase()) {
            case "loganalytics":
                global.logger.log("verbose", `destination "${this.name}" connector is set to "LogAnalytics".`);
                return this.postToLogAnalytics;
            case "url":
                global.logger.log("verbose", `destination "${this.name}" connector is set to "URL".`);
                return this.postToURL;
            default:
                global.logger.log("verbose", `destination "${this.name}" connector is set to "auto".`);
                return this.post;
        }
    }

    public dispatch() {

        // there is no reason to run
        if (this.buffer.length < 1) {
            global.logger.log("silly", `an attempt to dispatch to config "${this.config.name}" dest "${this.name}" found nothing in the buffer (abort).`);
            return;
        }

        // if something is already being dispatched, ignore
        if (this.isBusy) {
            global.logger.log("debug", `an attempt to dispatch to config "${this.config.name}" dest "${this.name}" found it busy (abort).`);
            return;
        };

        // function to do the work of dispatching, could be looped several times
        const action = async () => {
            try {

                // get a reference to the buffer (improves performance)
                const buffer = this.buffer;

                // make sure there is something to dispatch
                if (buffer.length < 1) {
                    global.logger.log("silly", `an attempt to dispatch to config "${this.config.name}" dest "${this.name}" found nothing in the buffer (abort).`);
                    this.handle = undefined;
                    return;
                }
                
                // split everything into a batch and checkpoints and files (for metrics)
                const batch = [];
                const checkpoints = [];
                const files = [];
                for (const row of buffer) {
                    if (row.__checkpoint) {
                        checkpoints.push(row);
                    } else if (batch.length >= global.batchSize) {
                        break;
                    } else {
                        const use = Object.assign({}, row);
                        delete use.__file;
                        delete use.__raw;
                        batch.push(use);
                        const file = files.find(f => f.path === row.__file);
                        if (file) {
                            file.count++;
                        } else {
                            files.push({
                                path: row.__file,
                                count: 1
                            });
                        }
                    }
                }
                global.logger.log("verbose", `an attempt to dispatch to config "${this.config.name}" dest "${this.name}" found ${buffer.length} records in the buffer (including checkpoints), of which ${batch.length} records will be in the batch, committing ${checkpoints.length} checkpoints.`);

                // post to the appropriate connector
                await this.connectorFunction(batch);

                // remove from buffer
                this.buffer.splice(0, batch.length + checkpoints.length);
                global.logger.log("verbose", `posted ${batch.length} records to config "${this.config.name}" dest "${this.name}" successfully, ${buffer.length} records (including checkpoints) remaining.`);

                // update checkpoints
                for (const row of checkpoints) {
                    row.__checkpoint.committed = row.__pointer;
                    global.logger.log("debug", `the checkpoint path "${row.__checkpoint.path}" to "${row.__checkpoint.destination}" committed to "${row.__checkpoint.committed}".`);
                }

                // record the flow metrics
                for (const file of files) {
                    global.metrics.add(this.name, this.config.name, file.path, file.count);
                }

                // keep going or clear
                if (this.buffer.length >= global.batchSize) {
                    this.handle = setTimeout(_ => { action(); }, 0); // NOTE: need to encapsulate function call so "this" is correct
                } else {
                    this.handle = undefined;
                    global.checkpoints.send();
                }

            } catch (error) {

                // log the error
                global.logger.error(`config "${this.config.name}" dest "${this.name}" failed to post batch to "${this.url}".`, {
                    config: this.config.name
                });
                global.logger.error(error.stack, {
                    config: this.config.name
                });
                
                // try again
                this.handle = setTimeout(_ => { action(); }, tryAfter);

            }
        }

        // kick off the read action immediately
        this.handle = setTimeout(_ => { action(); }, 0); // this makes the dispatch busy
        
    }

    /** This should be called before releasing all references to Destination. */
    public dispose() {
        if (this.handle) {
            clearTimeout(this.handle);
            this.handle = undefined;
        }
        if (this.dispatcher) {
            clearInterval(this.dispatcher);
            this.dispatcher = undefined;
        }
        this.buffer = [];
    }

    constructor(config: Configuration, obj: DestinationJSON) {
        super(obj);

        // base properties
        this.config = config;
        this.name = obj.name;
        if (obj.connector) this.connector = obj.connector;
        if (obj.url) this.url = obj.url;
        if (obj.workspaceId) this.workspaceId = obj.workspaceId;
        if (obj.workspaceKey) this.workspaceKey = obj.workspaceKey;
        if (obj.logType) this.logType = obj.logType;

        // set the dispatch interval
        if (this.config.enabled) {
            this.dispatcher = setInterval(_ => { this.dispatch(); }, dispatchEvery);
        }

    }

}