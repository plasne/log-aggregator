// includes
import azs = require("azure-storage");
import { BlobService } from "azure-storage";

type modes = "account/key" | "host/sas";

export default class Blob {
    public account?: string;
    public key?: string;
    public host?: string;
    public sas?: string;
    public service!: BlobService;

    // connect to azure storage
    createService() {
        if (this.sas && this.host) {
            global.logger.log("verbose", `SAS found, connecting to Azure storage`);
            this.service = azs.createBlobServiceWithSas(this.host, this.sas);
        } else if (this.account && this.key) {
            global.logger.log("verbose", `Account and key found, connecting to Azure storage`);
            this.service = azs.createBlobService(this.account, this.key);
        } else {
            global.logger.log("error", `Could not connect to Azure storage; no credentials supplied`);

            throw new Error(`Could not connect to Azure storage; no credentials supplied`);
        }
    }

    // write the block blob, or if the container does not exist, create container and then write block blob
    async writeOrCreate(container: string, blob: string, text: string) {
        try {
            await this.write(container, blob, text);
            return;
        } catch (e) {
            global.logger.log("error", `Could not write to container: ${e}`);
        }

        global.logger.log("verbose", `Attempting to create container "${container}"`);
        try {
            await this.createContainer(container);
            await this.write(container, blob, text);
        } catch (e) {
            throw new Error(`Could not create container "${container}": ${e}`);
        }
    }

    // create the azure container
    createContainer(container: string) {
        return new Promise((resolve, reject) => {
            this.service.createContainerIfNotExists(container, function (error, result) {
                if (error) {
                    global.logger.log("error", `Container "${container}" could not be created: ${error}`);
                    reject(error);
                } else {
                    resolve(result);
                }
            });
        });
    }

    // write block blob
    write(container: string, blob: string, text: string) {
        return new Promise((resolve, reject) => {
            this.service.createBlockBlobFromText(container, blob, text, function (error, result) {
                if (error) {
                    global.logger.log("error", `Blob "${blob}" could not be created with text: ${error}`);
                    reject(error);
                } else {
                    resolve(result);
                }
            });
        });
    }

    // read specified block blob contents as JSON
    read(container: string, blob: string) {
        return new Promise((resolve, reject) => {
            this.service.getBlobToText(container, blob, function (error, result) {
                if (error) {
                    global.logger.log("error", `Could not read blob "${blob}" in container "${container}": ${error}`);
                    reject(error);
                } else {
                    const json = JSON.parse(result);
                    resolve(json);
                }
            });
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
        // do not catch - without a service we cannot continue
        this.createService();
    }
}