declare module "deasync" {
    function deasync<T>(promise: Promise<T>): T
    export = deasync
}
