
// includes
import Operation, { OperationJSON } from "./Operation";

export interface TestableJSON {
    and?: Array<OperationJSON>;
    or?:  Array<OperationJSON>;
    not?: Array<OperationJSON>;
}

export default class Testable {

    public and?: Array<Operation> = undefined;
    public or?:  Array<Operation> = undefined;
    public not?: Array<Operation> = undefined;

    testAnd(row: any) {
        if (!this.and || this.and.length < 1) return true;
        for (const entry of this.and) {
            const val = row[entry.field];
            if (!val) return false;
            const exp = new RegExp(entry.test, "gm");
            if (!exp.test(val)) return false;
        }
        return true;
    }

    testOr(row: any) {
        if (!this.or || this.or.length < 1) return true;
        for (const entry of this.or) {
            const val = row[entry.field];
            const exp = new RegExp(entry.test, "gm");
            if (exp.test(val)) return true;
        }
        return false;
    }

    testNot(row: any) { // this is actually not-and
        if (!this.not || this.not.length < 1) return true;
        for (const entry of this.not) {
            const val = row[entry.field];
            if (!val) return false;
            const exp = new RegExp(entry.test, "gm");
            if (exp.test(val)) return false;
        }
        return true;
    }

    constructor(obj: TestableJSON) {
        if (obj.and) {
            this.and = [];
            for (const and of obj.and) {
                this.and.push( new Operation(and) );
            }
        }
        if (obj.or) {
            this.or = [];
            for (const or of obj.or) {
                this.or.push( new Operation(or) );
            }
        }
        if (obj.not) {
            this.not = [];
            for (const not of obj.not) {
                this.not.push( new Operation(not) );
            }
        }
    }

}