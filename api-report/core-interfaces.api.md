## API Report File for "@fluidframework/core-interfaces"

> Do not edit this file. It is a report generated by [API Extractor](https://api-extractor.com/).

```ts

// Warning: (ae-incompatible-release-tags) The symbol "FluidObject" is marked as @public, but its signature references "FluidObjectProviderKeys" which is marked as @internal
//
// @public
export type FluidObject<T = unknown> = {
    [P in FluidObjectProviderKeys<T>]?: T[P];
};

// @public
export type FluidObjectKeys<T> = keyof FluidObject<T>;

// @internal
export type FluidObjectProviderKeys<T, TProp extends keyof T = keyof T> = string extends TProp ? never : number extends TProp ? never : TProp extends keyof Required<T>[TProp] ? Required<T>[TProp] extends Required<Required<T>[TProp]>[TProp] ? TProp : never : never;

// @public
export interface IDisposable {
    dispose(error?: Error): void;
    readonly disposed: boolean;
}

// @public @deprecated
export interface IFluidCodeDetails {
    readonly config?: IFluidCodeDetailsConfig;
    readonly package: string | Readonly<IFluidPackage>;
}

// @public @deprecated (undocumented)
export const IFluidCodeDetailsComparer: keyof IProvideFluidCodeDetailsComparer;

// @public @deprecated
export interface IFluidCodeDetailsComparer extends IProvideFluidCodeDetailsComparer {
    compare(a: IFluidCodeDetails, b: IFluidCodeDetails): Promise<number | undefined>;
    satisfies(candidate: IFluidCodeDetails, constraint: IFluidCodeDetails): Promise<boolean>;
}

// @public @deprecated
export interface IFluidCodeDetailsConfig {
    // (undocumented)
    readonly [key: string]: string;
}

// @public (undocumented)
export const IFluidHandle: keyof IProvideFluidHandle;

// @public
export interface IFluidHandle<T = FluidObject & IFluidLoadable> extends IProvideFluidHandle {
    // @deprecated (undocumented)
    readonly absolutePath: string;
    // @deprecated (undocumented)
    attachGraph(): void;
    // @deprecated (undocumented)
    bind(handle: IFluidHandle): void;
    get(): Promise<T>;
    readonly isAttached: boolean;
}

// @public (undocumented)
export const IFluidHandleContext: keyof IProvideFluidHandleContext;

// @public
export interface IFluidHandleContext extends IProvideFluidHandleContext {
    readonly absolutePath: string;
    attachGraph(): void;
    readonly isAttached: boolean;
    // (undocumented)
    resolveHandle(request: IRequest): Promise<IResponse>;
    readonly routeContext?: IFluidHandleContext;
}

// @public (undocumented)
export const IFluidLoadable: keyof IProvideFluidLoadable;

// @public
export interface IFluidLoadable extends IProvideFluidLoadable {
    // (undocumented)
    handle: IFluidHandle;
}

// @public @deprecated
export interface IFluidPackage {
    [key: string]: unknown;
    fluid: {
        [environment: string]: undefined | IFluidPackageEnvironment;
    };
    name: string;
}

// @public @deprecated
export interface IFluidPackageEnvironment {
    [target: string]: undefined | {
        files: string[];
        [key: string]: unknown;
    };
}

// @public (undocumented)
export const IFluidRouter: keyof IProvideFluidRouter;

// @public (undocumented)
export interface IFluidRouter extends IProvideFluidRouter {
    // (undocumented)
    request(request: IRequest): Promise<IResponse>;
}

// @public (undocumented)
export const IFluidRunnable: keyof IProvideFluidRunnable;

// @public (undocumented)
export interface IFluidRunnable {
    // (undocumented)
    run(...args: any[]): Promise<void>;
    // (undocumented)
    stop(reason?: string): void;
}

// @public
export interface ILoggingError extends Error {
    getTelemetryProperties(): ITelemetryProperties;
}

// @public @deprecated (undocumented)
export interface IProvideFluidCodeDetailsComparer {
    // (undocumented)
    readonly IFluidCodeDetailsComparer: IFluidCodeDetailsComparer;
}

// @public (undocumented)
export interface IProvideFluidHandle {
    // (undocumented)
    readonly IFluidHandle: IFluidHandle;
}

// @public (undocumented)
export interface IProvideFluidHandleContext {
    // (undocumented)
    readonly IFluidHandleContext: IFluidHandleContext;
}

// @public (undocumented)
export interface IProvideFluidLoadable {
    // (undocumented)
    readonly IFluidLoadable: IFluidLoadable;
}

// @public
export interface IProvideFluidRouter {
    // (undocumented)
    readonly IFluidRouter: IFluidRouter;
}

// @public (undocumented)
export interface IProvideFluidRunnable {
    // (undocumented)
    readonly IFluidRunnable: IFluidRunnable;
}

// @public (undocumented)
export interface IRequest {
    // (undocumented)
    headers?: IRequestHeader;
    // (undocumented)
    url: string;
}

// @public (undocumented)
export interface IRequestHeader {
    // (undocumented)
    [index: string]: any;
}

// @public (undocumented)
export interface IResponse {
    // (undocumented)
    headers?: {
        [key: string]: any;
    };
    // (undocumented)
    mimeType: string;
    // (undocumented)
    stack?: string;
    // (undocumented)
    status: number;
    // (undocumented)
    value: any;
}

// @public @deprecated (undocumented)
export const isFluidCodeDetails: (details: unknown) => details is Readonly<IFluidCodeDetails>;

// @public @deprecated
export const isFluidPackage: (pkg: any) => pkg is Readonly<IFluidPackage>;

// @public
export interface ITaggedTelemetryPropertyType {
    // (undocumented)
    tag: string;
    // (undocumented)
    value: TelemetryEventPropertyType;
}

// @public
export interface ITelemetryBaseEvent extends ITelemetryProperties {
    // (undocumented)
    category: string;
    // (undocumented)
    eventName: string;
}

// @public
export interface ITelemetryBaseLogger {
    // (undocumented)
    send(event: ITelemetryBaseEvent): void;
}

// @public
export interface ITelemetryErrorEvent extends ITelemetryProperties {
    // (undocumented)
    eventName: string;
}

// @public
export interface ITelemetryGenericEvent extends ITelemetryProperties {
    // (undocumented)
    category?: TelemetryEventCategory;
    // (undocumented)
    eventName: string;
}

// @public
export interface ITelemetryLogger extends ITelemetryBaseLogger {
    send(event: ITelemetryBaseEvent): void;
    sendErrorEvent(event: ITelemetryErrorEvent, error?: any): void;
    sendPerformanceEvent(event: ITelemetryPerformanceEvent, error?: any): void;
    sendTelemetryEvent(event: ITelemetryGenericEvent, error?: any): void;
}

// @public
export interface ITelemetryPerformanceEvent extends ITelemetryGenericEvent {
    // (undocumented)
    duration?: number;
}

// @public
export interface ITelemetryProperties {
    // (undocumented)
    [index: string]: TelemetryEventPropertyType | ITaggedTelemetryPropertyType;
}

// @public
export type TelemetryEventCategory = "generic" | "error" | "performance";

// @public
export type TelemetryEventPropertyType = string | number | boolean | undefined;

// (No @packageDocumentation comment for this package)

```
