
// sends messages to Log Analytics and verifies that they have been received.

// includes
require("dotenv").config();
import cmd = require("commander");
import moment = require("moment");
import axios from "axios";
import * as adal from "adal-node";
import * as readline from "readline";
import { createHmac } from "crypto";
import Latency from "./lib/Latency";
import { v4 as uuid } from "uuid";

// define command line parameters
cmd
    .version("0.1.0")
    .option("-d, --directory <string>", `[REQUIRED] DIRECTORY. Specify the Azure AD directory that contains the Application ID and Key that has access to Log Analytics.`)
    .option("-w, --workspace-id <string>", `[REQUIRED] WORKSPACE_ID. Specify the Log Analytics Workspace ID.`)
    .option("-k, --workspace-key <string>", `[REQUIRED] WORKSPACE_KEY. Specify the Log Analytics Workspace Key.`)
    .option("-a, --application-id <string>", `[REQUIRED] APPLICATION_ID. Specify the Application ID that has access to Log Analytics.`)
    .option("-s, --application-key <string>", `[REQUIRED] APPLICATION_KEY. Specify the Application Key that provides the credentials for logging in the Application ID.`);

// global variables
let directory: string, workspaceId: string, workspaceKey: string,
    applicationId: string, applicationKey: string;
function populateGlobals() {

    // set the values
    directory       = cmd.directory       || process.env.DIRECTORY;
    workspaceId     = cmd.workspaceId     || process.env.WORKSPACE_ID;
    workspaceKey    = cmd.workspaceKey    || process.env.WORKSPACE_KEY;
    applicationId   = cmd.applicationId   || process.env.APPLICATION_ID;
    applicationKey  = cmd.applicationKey  || process.env.APPLICATION_KEY;

    // confirm they are set
    if (!directory) throw new Error("DIRECTORY must be set.");
    console.log(`DIRECTORY = "${directory}"`);
    if (!workspaceId) throw new Error("WORKSPACE_ID must be set.");
    console.log(`WORKSPACE_ID = "${workspaceId}"`);
    if (!workspaceKey) throw new Error("WORKSPACE_KEY must be set.");
    console.log(`WORKSPACE_KEY = "obscured"`);
    if (!applicationId) throw new Error("APPLICATION_ID must be set.");
    console.log(`APPLICATION_ID = "${applicationId}"`);
    if (!applicationKey) throw new Error("APPLICATION_KEY must be set.");
    console.log(`APPLICATION_KEY = "obscured"`);

}

// interfaces
interface message {
    timestamp: string,
    written:   string,
    id:        string
};
interface results {
    columns: any[],
    rows:    any[]
}

// write out the errors from axios
function handleAxiosError(error: any) {
    console.log("\n");
    if (error.response) {
        console.error(`HTTP ${error.response.status}`);
        if (error.response.data.error) {
            let pointer = error.response.data.error;
            while (pointer) {
                console.error(pointer.message);
                pointer = pointer.innererror;
            }
        } else {
            console.error(error.response.data);
        }
    } else if (error.request) {
        console.error(error.request);
    } else {
        console.error(error.message);
    }
}

// execute an arbitrary query
async function query(query: string): Promise<results> {

    // get an access token
    const context = new adal.AuthenticationContext("https://login.windows.net/" + directory);
    const tokenResponse = await new Promise<adal.TokenResponse>((resolve, reject) => {
        context.acquireTokenWithClientCredentials("https://api.loganalytics.io", applicationId, applicationKey, (error, tokenResponse) => {
            const isTokenResponse = (o: adal.TokenResponse | adal.ErrorResponse): o is adal.TokenResponse => o.hasOwnProperty("accessToken");
            if (!error && isTokenResponse(tokenResponse)) {
                resolve(tokenResponse);
            } else if (error) {
                reject(error);
            } else {
                reject(tokenResponse.error);
            }
        });
    });

    // submit the query
    const response = await axios({
        method: "post",
        url: `https://api.loganalytics.io/v1/workspaces/${workspaceId}/query`,
        headers: {
            "Authorization": `Bearer ${tokenResponse.accessToken}`,
            "Content-Type": "application/json"
        },
        data: {
            query: query
        }
    });
    return {
        columns: response.data.tables[0].columns,
        rows:    response.data.tables[0].rows
    } as results;

}

// execute an arbitrary post
async function post(batch: message | message[], type: string): Promise<void> {

    // create the signature
    const ts = moment().utc().format("ddd, DD MMM YYYY HH:mm:ss ") + "GMT"; // RFC-1123
    const payload = JSON.stringify(batch);
    const len = Buffer.byteLength(payload);
    const code = `POST\n${len}\napplication/json\nx-ms-date:${ts}\n/api/logs`;
    const hmac = createHmac("sha256", Buffer.from(workspaceKey, "base64"));
    const signature = hmac.update(code, "utf8").digest("base64");

    // post
    await axios({
        method: "post",
        url: `https://${workspaceId}.ods.opinsights.azure.com/api/logs?api-version=2016-04-01`,
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Log-Type": type,
            "x-ms-date": ts,
            "time-generated-field": "timestamp",
            "Authorization": `SharedKey ${workspaceId}:${signature}`
        },
        data: payload
    });

}

// query test
cmd
    .command("query")
    .description("This command lets you test connectivity to the Log Analytics instance by running a query to return all records from the past 24 hours.")
    .action(async () => {
        try {
            populateGlobals();
            console.log("querying...");
            const results: results = await query("blob_CL | where written_t >= ago(1h) | project TimeGenerated, written_t, id_g");
            console.log(results.columns);
            console.log(results.rows);
            console.log(`columns: ${results.columns.length}, rows: ${results.rows.length}`);
        } catch (error) {
            handleAxiosError(error);
        }
    });

// post test
cmd
    .command("post")
    .description("This command lets you test connectivity to the Log Analytics instance by posting a message.")
    .action(async () => {
        try {
            populateGlobals();
            const batch = {
                timestamp: moment().utc().format("YYYY-MM-DDTHH:mm:ss") + "Z",
                written:   moment().utc().format("YYYY-MM-DDTHH:mm:ss") + "Z",
                id:        uuid()
            };
            await post(batch, "post");
            console.log(`a message was posted successfully.`);
        } catch (error) {
            console.error(error);
        }
    });

// run a test
cmd
    .command("run <testname>")
    .option("-o, --offset <integer>", `OFFSET. Specify a number will cause the application to generate timestamps offset by that number of hours. For example, 25 will generate timestamp values 25 hours in the past.`, parseInt)
    .option("-b, --batch-size <integer>", `BATCH_SIZE. Specify the number of messages to be sent every post cycle. Defaults to "1".`, parseInt)
    .option("-p, --post-every <integer>", `POST_EVERY. Specify a number of milliseconds to wait between posts to the server. Default is "10000" (every 10 seconds).`, parseInt)
    .option("-q, --query-every <integer>", `QUERY_EVERY. Specify a number of milliseconds to wait between querying the server to look for results. Default is "60000" (every 1 minute).`, parseInt)
    .option("-t, --timeout <integer>", `TIMEOUT. Specify a number of minutes to wait for a message to show up before it times out. Default is "60" (1 hour).`, parseInt)
    .action((testname: string, opt: any) => {
        
        // variables
        populateGlobals();
        const offset          = opt.offset          || process.env.OFFSET           || 0;
        const batchSize       = opt.batchSize       || process.env.BATCH_SIZE       || 1;
        const postEvery       = opt.postEvery       || process.env.POST_EVERY       || 10000;
        const queryEvery      = opt.queryEvery      || process.env.QUERY_EVERY      || 60000;
        const timeout         = opt.timeout         || process.env.TIMEOUT          || 60;
        const latency         = new Latency();

        // log
        console.log(`OFFSET = "${offset}" (ex. "${moment().utc().subtract(offset, "hours").format("YYYY-MM-DDTHH:mm:ss") + "Z"}")`);
        console.log(`BATCH_SIZE = "${batchSize}"`);
        console.log(`POST_EVERY = "${postEvery}"`);
        console.log(`QUERY_EVERY = "${queryEvery}"`);
        console.log(`TIMEOUT = "${timeout}"`);
        console.log(`TESTNAME = "${testname}"`);

        // buffer messages until they are found or timeout
        let messages: message[] = [];
        let timeouts: message[] = [];
        let oldest: number = 0; // in sec
        console.log(`started at ${moment().utc().format()}...`);

        // refresh
        const refresh = () => {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`messages outstanding: ${messages.length}, confirmed: ${latency.count}, timeouts: ${timeouts.length}, oldest: ${(oldest / 60).toFixed(2)} minutes`);
        };

        // post a message
        setInterval(() => {
            try {

                // generate the messages
                let batch: message | message[];
                if (batchSize === 1) {
                    batch = {
                        timestamp: moment().utc().subtract(offset, "hours").format("YYYY-MM-DDTHH:mm:ss") + "Z",
                        written:   moment().utc().format("YYYY-MM-DDTHH:mm:ss") + "Z",
                        id:        uuid()
                    };
                    messages.push(batch);
                } else {
                    batch = [];
                    for (let i = 0; i < batchSize; i++) {
                        const message = {
                            timestamp: moment().utc().subtract(offset, "hours").format("YYYY-MM-DDTHH:mm:ss") + "Z",
                            written:   moment().utc().format("YYYY-MM-DDTHH:mm:ss") + "Z",
                            id:        uuid()
                        };
                        batch.push(message);
                        messages.push(message);
                    }
                }

                // post
                post(batch, testname);

                // refresh
                refresh();

            } catch (error) {
                handleAxiosError(error);
            }
        }, postEvery);

        // look for messages after they have been posted
        setInterval(async () => {
            try {

                // query for everything in the timeout timeframe
                const results = await query(`${testname}_CL | where written_t >= ago(${timeout}m) | project TimeGenerated, written_t, id_g`);

                // find all IDs that were in the sets
                const listOfIds: string[] = [];
                const index = results.columns.findIndex(column => column.name === "id_g");
                if (index > -1) {
                    for (let row of results.rows) {
                        const id: string = row[index];
                        listOfIds.push(id);
                    }
                } else {
                    console.log(`id not found in columns.`);
                }

                // count everything that was found
                const leftovers: message[] = [];
                const now = moment().utc();
                oldest = 0;
                for (let message of messages) {
                    const written = moment(message.written);
                    const elapsed: number = now.diff(written, "seconds");
                    if (elapsed > oldest) oldest = elapsed;
                    if (elapsed > timeout * 60) {
                        timeouts.push(message);
                    } else if (listOfIds.includes(message.id)) {
                        latency.add(elapsed);
                    } else {
                        leftovers.push(message);
                    }
                }

                // continue looking for the leftovers
                messages = leftovers;

                // refresh
                refresh();

            } catch (error) {
                handleAxiosError(error);
            }
        }, queryEvery);

        // capture SIGINT (ctrl-c) so that I can show the summary
        process.on("SIGINT", () => {
            console.log("\n");
            console.log(`ended at ${moment().utc().format()}...`);
            console.log(`messages outstanding: ${messages.length}, confirmed: ${latency.count}, timeouts: ${timeouts.length}`);
            const buckets = latency.calc();
            for (let bucket of buckets) {
                const latency = (bucket.avg) ? `, ${bucket.avg} sec avg latency (${bucket.min} - ${bucket.max})` : "";
                console.log(`${(bucket.range < 1) ? " " : ""}${(bucket.range * 100).toFixed(3)}%: ${bucket.count} confirmed${latency}`);
            }
            console.log("\ntimeouts:");
            for (const message of timeouts) {
                console.log(`${message.timestamp}: ${message.id}, written @ ${message.written}`);
            }
            process.exit();
        });

    });

// parse the command line arguments
cmd.parse(process.argv);
