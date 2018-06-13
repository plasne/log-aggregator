
export interface OperationJSON {
    field?: string;
    test:   string;
}

export default class Operation {

    public field: string = "__raw";
    public test:  string;

    constructor(obj: OperationJSON) {
        if (obj.field) this.field = obj.field;
        this.test = obj.test;
    }
    
}