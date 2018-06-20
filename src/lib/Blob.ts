
// includes
import azs = require("azure-storage");
import { BlobService } from "azure-storage";

export default class Blob {

    public account: string;
    public key: string;
    public host: string;
    public sas: string;
    public service!: BlobService;

    connect(container: string, name: string, overwrite: boolean) {

        let service;

        // connect to azure storage
        if (null !== this.sas && null !== this.host) {
            global.logger.log("verbose", `SAS found, connecting to Azure storage`);
            service = azs.createBlobServiceWithSas(this.host, this.sas);
        } else if (null !== this.account && null !== this.key) {
            global.logger.log("verbose", `Account and key found, connecting to Azure storage`);
            service = azs.createBlobService(this.account, this.key);
        } else {
            global.logger.log("error", `Could not connect to Azure storage; no credentials supplied`);
            return false;
        }

        // connect to or create the container
        try {
            service.createContainerIfNotExists(container, function (error) {
                if (error) {
                    global.logger.log("error", `Container "${container}" connect/create encountered an error: ${error}`);
                    return false;
                }
            });
        } catch (ex) {
            global.logger.log("error", `Container "${container}" exception: ${ex}`);
            return false;
        }

        // check that blob exists and is writable
        try {
            service.doesBlobExist(container, name, function (error, result, response) {
                if (error) {
                    global.logger.log("error", `Error verifying blob "${name}: ${error}`);
                    return false;
                } else {
                    if (!result.exists || overwrite) {
                        this.service = service;
                        return true;
                    }

                    return false;
                }
            });
        } catch (ex) {
            global.logger.log("error", `Blob "${name}" exception: ${ex}`);
            return false;
        }
    }

    read() {

    }

    constructor(account: string, key: string, sas: string, host: string) {
        this.account = account;
        this.key = key;
        this.host = host;
        this.sas = sas;
    }
}