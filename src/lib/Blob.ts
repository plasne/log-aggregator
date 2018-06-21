
// includes
import azs = require("azure-storage");
import * as fs from "fs";
import { BlobService } from "azure-storage";
import { error } from "util";

type modes = "account/key" | "host/sas";

export default class Blob {

    public account?: string;
    public key?: string;
    public host?: string;
    public sas?: string;
    public service!: BlobService;

    // connect to azure storage
    private async function createService() {
        if (null !== this.sas && null !== this.host) {
            global.logger.log("verbose", `SAS found, connecting to Azure storage`);
            this.service = azs.createBlobServiceWithSas(this.host, this.sas);
        } else if (null !== this.account && null !== this.key) {
            global.logger.log("verbose", `Account and key found, connecting to Azure storage`);
            this.service = azs.createBlobService(this.account, this.key);
        } else {
            global.logger.log("error", `Could not connect to Azure storage; no credentials supplied`);

            // no read/write possible without a connection
            throw new Error(`Could not connect to Azure storage; no credentials supplied`);
        }
    }

    // create a new container if not exists
    private async function createContainer(container: string) {
        this.service.createContainerIfNotExists(container, function (error, result, response) {
            if (error) {
                global.logger.log("error", `Container "${container}" connect/create encountered an error: ${error}`);
                return false;
            }

            return true;
        });
    }

    // create an empty append blob for writing 
    private async function createBlob(container: string, name: string) {
        this.service.createAppendBlobFromText(container, name, '', function (error, result, response) {
            if (error) {
                global.logger.log("error", `Blob "${name}" encountered an error: ${error}`);
                return false;
            }

            return true;
        });
    }

    // return the blob data or connect to container if not exists
    private async function blobDataOrConnect(error: Error, text: string) {
        if (error) {
            // TODO: parse error and create if needed
            global.logger.log("error", `Error getting blob "${blobName}"`);
            global.logger.error(error);

            try {
                const containerResponse = await this.createContainer(container);
                const blobResponse = await this.createBlob(container, blobName);
            } catch (e) {
                global.logger.log("error", `Error creating container/blob`);
                global.logger.error(e);
            }

            return false;
        }

        return true;
    }

    // read contents of existing blob, or create the container and blob if not exists
    async read(container: string, blobName: string) {
        this.service.getBlobToText(container, blobName, this.blobDataOrConnect);
    }

    // append text to existing blob
    async write(container: string, blobName: string, text: string) {
        this.service.appendFromText(container, blob, text, function (error, result, response) {
            if (error) {
                global.logger.log("error", `Error appending "${text}" to blob "${blob}"`);
                global.logger.error(error);

                return false;
            }

            return true;
        });
    }

    constructor(mode: modes, id: string, code: string) {
        switch (mode) {
            case "account/key":
                this.account = id;
                this.key = code;
                break;
            case "host/sas":
                this.host = id;
                this.sas = code;
                break;
        }

        // create the service so it can be used to read/write
        // do not catch - without a service we can't continue
        await this.createService();
    }
}