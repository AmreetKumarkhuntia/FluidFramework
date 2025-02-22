/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import {
	ITelemetryBaseEvent,
	ITelemetryBaseLogger,
	ITelemetryErrorEvent,
	ITelemetryGenericEvent,
	ITelemetryPerformanceEvent,
	ITelemetryProperties,
	TelemetryEventPropertyType,
	ITaggedTelemetryPropertyType,
	TelemetryEventCategory,
} from "@fluidframework/core-interfaces";
import { IsomorphicPerformance, performance } from "@fluidframework/common-utils";
import { CachedConfigProvider, loggerIsMonitoringContext, mixinMonitoringContext } from "./config";
import {
	isILoggingError,
	extractLogSafeErrorProperties,
	generateStack,
	isTaggedTelemetryPropertyValue,
} from "./errorLogging";
import {
	ITaggedTelemetryPropertyTypeExt,
	ITelemetryEventExt,
	ITelemetryGenericEventExt,
	ITelemetryLoggerExt,
	ITelemetryPerformanceEventExt,
	TelemetryEventPropertyTypeExt,
} from "./telemetryTypes";

export interface Memory {
	usedJSHeapSize: number;
}

export interface PerformanceWithMemory extends IsomorphicPerformance {
	readonly memory: Memory;
}
/**
 * Broad classifications to be applied to individual properties as they're prepared to be logged to telemetry.
 * Please do not modify existing entries for backwards compatibility.
 */
export enum TelemetryDataTag {
	/** Data containing terms or IDs from code packages that may have been dynamically loaded */
	CodeArtifact = "CodeArtifact",
	/** Personal data of a variety of classifications that pertains to the user */
	UserData = "UserData",
}

export type TelemetryEventPropertyTypes = TelemetryEventPropertyType | ITaggedTelemetryPropertyType;

export interface ITelemetryLoggerPropertyBag {
	[index: string]: TelemetryEventPropertyTypes | (() => TelemetryEventPropertyTypes);
}
export interface ITelemetryLoggerPropertyBags {
	all?: ITelemetryLoggerPropertyBag;
	error?: ITelemetryLoggerPropertyBag;
}

/**
 * Attempts to parse number from string.
 * If fails,returns original string.
 * Used to make telemetry data typed (and support math operations, like comparison),
 * in places where we do expect numbers (like contentsize/duration property in http header)
 */
export function numberFromString(str: string | null | undefined): string | number | undefined {
	if (str === undefined || str === null) {
		return undefined;
	}
	const num = Number(str);
	return Number.isNaN(num) ? str : num;
}

export function formatTick(tick: number): number {
	return Math.floor(tick);
}

export const eventNamespaceSeparator = ":" as const;

/**
 * TelemetryLogger class contains various helper telemetry methods,
 * encoding in one place schemas for various types of Fluid telemetry events.
 * Creates sub-logger that appends properties to all events
 *
 * @deprecated - In a subsequent release this type will no longer be exported, use ITelemetryLogger instead
 */
export abstract class TelemetryLogger implements ITelemetryLoggerExt {
	public static readonly eventNamespaceSeparator = eventNamespaceSeparator;

	/**
	 * @deprecated - use formatTick
	 */
	public static formatTick(tick: number): number {
		return Math.floor(tick);
	}

	/**
	 * Attempts to parse number from string.
	 * If fails,returns original string.
	 * Used to make telemetry data typed (and support math operations, like comparison),
	 * in places where we do expect numbers (like contentsize/duration property in http header)
	 * @deprecated - use numberFromString
	 */
	public static numberFromString(str: string | null | undefined): string | number | undefined {
		if (str === undefined || str === null) {
			return undefined;
		}
		const num = Number(str);
		return Number.isNaN(num) ? str : num;
	}

	public static sanitizePkgName(name: string) {
		return name.replace("@", "").replace("/", "-");
	}

	/**
	 * Take an unknown error object and add the appropriate info from it to the event. Message and stack will be copied
	 * over from the error object, along with other telemetry properties if it's an ILoggingError.
	 * @param event - Event being logged
	 * @param error - Error to extract info from
	 * @param fetchStack - Whether to fetch the current callstack if error.stack is undefined
	 */
	public static prepareErrorObject(event: ITelemetryBaseEvent, error: any, fetchStack: boolean) {
		const { message, errorType, stack } = extractLogSafeErrorProperties(
			error,
			true /* sanitizeStack */,
		);
		// First, copy over error message, stack, and errorType directly (overwrite if present on event)
		event.stack = stack;
		event.error = message; // Note that the error message goes on the 'error' field
		event.errorType = errorType;

		if (isILoggingError(error)) {
			// Add any other telemetry properties from the LoggingError
			const telemetryProp = error.getTelemetryProperties();
			for (const key of Object.keys(telemetryProp)) {
				if (event[key] !== undefined) {
					// Don't overwrite existing properties on the event
					continue;
				}
				event[key] = telemetryProp[key];
			}
		}

		// Collect stack if we were not able to extract it from error
		if (event.stack === undefined && fetchStack) {
			event.stack = generateStack();
		}
	}

	public constructor(
		protected readonly namespace?: string,
		protected readonly properties?: ITelemetryLoggerPropertyBags,
	) {}

	/**
	 * Send an event with the logger
	 *
	 * @param event - the event to send
	 */
	public abstract send(event: ITelemetryBaseEvent): void;

	/**
	 * Send a telemetry event with the logger
	 *
	 * @param event - the event to send
	 * @param error - optional error object to log
	 */
	public sendTelemetryEvent(event: ITelemetryGenericEventExt, error?: any) {
		this.sendTelemetryEventCore({ ...event, category: event.category ?? "generic" }, error);
	}

	/**
	 * Send a telemetry event with the logger
	 *
	 * @param event - the event to send
	 * @param error - optional error object to log
	 */
	protected sendTelemetryEventCore(
		event: ITelemetryGenericEventExt & { category: TelemetryEventCategory },
		error?: any,
	) {
		const newEvent = convertToBaseEvent(event);
		if (error !== undefined) {
			TelemetryLogger.prepareErrorObject(newEvent, error, false);
		}

		// Will include Nan & Infinity, but probably we do not care
		if (typeof newEvent.duration === "number") {
			newEvent.duration = formatTick(newEvent.duration);
		}

		this.send(newEvent);
	}

	/**
	 * Send an error telemetry event with the logger
	 *
	 * @param event - the event to send
	 * @param error - optional error object to log
	 */
	public sendErrorEvent(event: ITelemetryErrorEvent, error?: any) {
		this.sendTelemetryEventCore(
			{
				// ensure the error field has some value,
				// this can and will be overridden by event, or error
				error: event.eventName,
				...event,
				category: "error",
			},
			error,
		);
	}

	/**
	 * Send a performance telemetry event with the logger
	 *
	 * @param event - Event to send
	 * @param error - optional error object to log
	 */
	public sendPerformanceEvent(event: ITelemetryPerformanceEventExt, error?: any): void {
		const perfEvent = {
			...event,
			category: event.category ?? "performance",
		};

		this.sendTelemetryEventCore(perfEvent, error);
	}

	protected prepareEvent(event: ITelemetryBaseEvent): ITelemetryBaseEvent {
		const includeErrorProps = event.category === "error" || event.error !== undefined;
		const newEvent: ITelemetryBaseEvent = {
			...event,
		};
		if (this.namespace !== undefined) {
			newEvent.eventName = `${this.namespace}${TelemetryLogger.eventNamespaceSeparator}${newEvent.eventName}`;
		}
		return this.extendProperties(newEvent, includeErrorProps);
	}

	private extendProperties<T extends ITelemetryLoggerPropertyBag = ITelemetryLoggerPropertyBag>(
		toExtend: T,
		includeErrorProps: boolean,
	) {
		const eventLike: ITelemetryLoggerPropertyBag = toExtend;
		if (this.properties) {
			const properties: (undefined | ITelemetryLoggerPropertyBag)[] = [];
			properties.push(this.properties.all);
			if (includeErrorProps) {
				properties.push(this.properties.error);
			}
			for (const props of properties) {
				if (props !== undefined) {
					for (const key of Object.keys(props)) {
						if (eventLike[key] !== undefined) {
							continue;
						}
						const getterOrValue = props[key];
						// If this throws, hopefully it is handled elsewhere
						const value =
							typeof getterOrValue === "function" ? getterOrValue() : getterOrValue;
						if (value !== undefined) {
							eventLike[key] = value;
						}
					}
				}
			}
		}
		return toExtend;
	}
}

/**
 * @deprecated 0.56, remove TaggedLoggerAdapter once its usage is removed from
 * container-runtime. Issue: #8191
 * TaggedLoggerAdapter class can add tag handling to your logger.
 */
export class TaggedLoggerAdapter implements ITelemetryBaseLogger {
	public constructor(private readonly logger: ITelemetryBaseLogger) {}

	public send(eventWithTagsMaybe: ITelemetryBaseEvent) {
		const newEvent: ITelemetryBaseEvent = {
			category: eventWithTagsMaybe.category,
			eventName: eventWithTagsMaybe.eventName,
		};
		for (const key of Object.keys(eventWithTagsMaybe)) {
			const taggableProp = eventWithTagsMaybe[key];
			const { value, tag } =
				typeof taggableProp === "object"
					? taggableProp
					: { value: taggableProp, tag: undefined };
			switch (tag) {
				case undefined:
					// No tag means we can log plainly
					newEvent[key] = value;
					break;
				case "PackageData": // For back-compat
				case TelemetryDataTag.CodeArtifact:
					// For Microsoft applications, CodeArtifact is safe for now
					// (we don't load 3P code in 1P apps)
					newEvent[key] = value;
					break;
				case TelemetryDataTag.UserData:
					// Strip out anything tagged explicitly as UserData.
					// Alternate strategy would be to hash these props
					newEvent[key] = "REDACTED (UserData)";
					break;
				default:
					// If we encounter a tag we don't recognize
					// then we must assume we should scrub.
					newEvent[key] = "REDACTED (unknown tag)";
					break;
			}
		}
		this.logger.send(newEvent);
	}
}

/**
 * Create a child logger based on the provided props object
 * @param props - logger is the base logger the child will log to after it's processing, namespace will be prefixed to all event names, properties are default properties that will be applied events.
 *
 * @remarks
 * Passing in no props object (i.e. undefined) will return a logger that is effectively a no-op.
 */
export function createChildLogger(props?: {
	logger?: ITelemetryBaseLogger;
	namespace?: string;
	properties?: ITelemetryLoggerPropertyBags;
}): ITelemetryLoggerExt {
	if (props === undefined) {
		return new TelemetryNullLogger();
	}
	return ChildLogger.create(props?.logger, props?.namespace, props?.properties);
}

/**
 * ChildLogger class contains various helper telemetry methods,
 * encoding in one place schemas for various types of Fluid telemetry events.
 * Creates sub-logger that appends properties to all events
 * @deprecated - Use createChildLogger instead
 */
export class ChildLogger extends TelemetryLogger {
	/**
	 * Create child logger
	 * @param baseLogger - Base logger to use to output events. If undefined, proper child logger
	 * is created, but it does not send telemetry events anywhere.
	 * @param namespace - Telemetry event name prefix to add to all events
	 * @param properties - Base properties to add to all events
	 */
	public static create(
		baseLogger?: ITelemetryBaseLogger,
		namespace?: string,
		properties?: ITelemetryLoggerPropertyBags,
	): TelemetryLogger {
		// if we are creating a child of a child, rather than nest, which will increase
		// the callstack overhead, just generate a new logger that includes everything from the previous
		if (baseLogger instanceof ChildLogger) {
			const combinedProperties: ITelemetryLoggerPropertyBags = {};
			for (const extendedProps of [baseLogger.properties, properties]) {
				if (extendedProps !== undefined) {
					if (extendedProps.all !== undefined) {
						combinedProperties.all = {
							...combinedProperties.all,
							...extendedProps.all,
						};
					}
					if (extendedProps.error !== undefined) {
						combinedProperties.error = {
							...combinedProperties.error,
							...extendedProps.error,
						};
					}
				}
			}

			const combinedNamespace =
				baseLogger.namespace === undefined
					? namespace
					: namespace === undefined
					? baseLogger.namespace
					: `${baseLogger.namespace}${TelemetryLogger.eventNamespaceSeparator}${namespace}`;

			return new ChildLogger(baseLogger.baseLogger, combinedNamespace, combinedProperties);
		}

		return new ChildLogger(
			baseLogger ? baseLogger : new BaseTelemetryNullLogger(),
			namespace,
			properties,
		);
	}

	private constructor(
		protected readonly baseLogger: ITelemetryBaseLogger,
		namespace: string | undefined,
		properties: ITelemetryLoggerPropertyBags | undefined,
	) {
		super(namespace, properties);

		// propagate the monitoring context
		if (loggerIsMonitoringContext(baseLogger)) {
			mixinMonitoringContext(this, new CachedConfigProvider(this, baseLogger.config));
		}
	}

	/**
	 * Send an event with the logger
	 *
	 * @param event - the event to send
	 */
	public send(event: ITelemetryBaseEvent): void {
		this.baseLogger.send(this.prepareEvent(event));
	}
}

/**
 * Create a logger which logs to multiple other loggers based on the provided props object
 * @param props - loggers are the base loggers that will logged to after it's processing, namespace will be prefixed to all event names, properties are default properties that will be applied events.
 * tryInheritProperties will attempted to copy those loggers properties to this loggers if they are of a known type e.g. one from this package
 */
export function createMultiSinkLogger(props: {
	namespace?: string;
	properties?: ITelemetryLoggerPropertyBags;
	loggers?: (ITelemetryBaseLogger | undefined)[];
	tryInheritProperties?: true;
}): ITelemetryLoggerExt {
	return new MultiSinkLogger(
		props.namespace,
		props.properties,
		props.loggers?.filter((l): l is ITelemetryBaseLogger => l !== undefined),
		props.tryInheritProperties,
	);
}

/**
 * Multi-sink logger
 * Takes multiple ITelemetryBaseLogger objects (sinks) and logs all events into each sink
 * @deprecated - use createMultiSinkLogger instead
 */
export class MultiSinkLogger extends TelemetryLogger {
	protected loggers: ITelemetryBaseLogger[];
	/**
	 * Create multiple sink logger (i.e. logger that sends events to multiple sinks)
	 * @param namespace - Telemetry event name prefix to add to all events
	 * @param properties - Base properties to add to all events
	 * @param loggers - The list of loggers to use as sinks
	 * @param tryInheritProperties - Will attempted to copy those loggers properties to this loggers if they are of a known type e.g. one from this package
	 */
	constructor(
		namespace?: string,
		properties?: ITelemetryLoggerPropertyBags,
		loggers: ITelemetryBaseLogger[] = [],
		tryInheritProperties?: true,
	) {
		let realProperties = properties !== undefined ? { ...properties } : undefined;
		if (tryInheritProperties === true) {
			const merge = (realProperties ??= {});
			loggers
				.filter((l): l is this => l instanceof TelemetryLogger)
				.map((l) => l.properties ?? {})
				.forEach((cv) => {
					Object.keys(cv).forEach((k) => {
						merge[k] = { ...cv[k], ...merge?.[k] };
					});
				});
		}

		super(namespace, realProperties);
		this.loggers = loggers;
	}

	/**
	 * Add logger to send all events to
	 * @param logger - Logger to add
	 */
	public addLogger(logger?: ITelemetryBaseLogger) {
		if (logger !== undefined && logger !== null) {
			this.loggers.push(logger);
		}
	}

	/**
	 * Send an event to the loggers
	 *
	 * @param event - the event to send to all the registered logger
	 */
	public send(event: ITelemetryBaseEvent): void {
		const newEvent = this.prepareEvent(event);
		this.loggers.forEach((logger: ITelemetryBaseLogger) => {
			logger.send(newEvent);
		});
	}
}

/**
 * Describes what events PerformanceEvent should log
 * By default, all events are logged, but client can override this behavior
 * For example, there is rarely a need to record start event, as we really after
 * success / failure tracking, including duration (on success).
 */
export interface IPerformanceEventMarkers {
	start?: true;
	end?: true;
	cancel?: "generic" | "error"; // tells wether to issue "generic" or "error" category cancel event
}

/**
 * Helper class to log performance events
 */
export class PerformanceEvent {
	public static start(
		logger: ITelemetryLoggerExt,
		event: ITelemetryGenericEvent,
		markers?: IPerformanceEventMarkers,
		recordHeapSize: boolean = false,
	) {
		return new PerformanceEvent(logger, event, markers, recordHeapSize);
	}

	public static timedExec<T>(
		logger: ITelemetryLoggerExt,
		event: ITelemetryGenericEvent,
		callback: (event: PerformanceEvent) => T,
		markers?: IPerformanceEventMarkers,
	) {
		const perfEvent = PerformanceEvent.start(logger, event, markers);
		try {
			const ret = callback(perfEvent);
			perfEvent.autoEnd();
			return ret;
		} catch (error) {
			perfEvent.cancel(undefined, error);
			throw error;
		}
	}

	public static async timedExecAsync<T>(
		logger: ITelemetryLoggerExt,
		event: ITelemetryGenericEvent,
		callback: (event: PerformanceEvent) => Promise<T>,
		markers?: IPerformanceEventMarkers,
		recordHeapSize?: boolean,
	) {
		const perfEvent = PerformanceEvent.start(logger, event, markers, recordHeapSize);
		try {
			const ret = await callback(perfEvent);
			perfEvent.autoEnd();
			return ret;
		} catch (error) {
			perfEvent.cancel(undefined, error);
			throw error;
		}
	}

	public get duration() {
		return performance.now() - this.startTime;
	}

	private event?: ITelemetryGenericEvent;
	private readonly startTime = performance.now();
	private startMark?: string;
	private startMemoryCollection: number | undefined = 0;

	protected constructor(
		private readonly logger: ITelemetryLoggerExt,
		event: ITelemetryGenericEvent,
		private readonly markers: IPerformanceEventMarkers = { end: true, cancel: "generic" },
		private readonly recordHeapSize: boolean = false,
	) {
		this.event = { ...event };
		if (this.markers.start) {
			this.reportEvent("start");
		}

		if (typeof window === "object" && window != null && window.performance?.mark) {
			this.startMark = `${event.eventName}-start`;
			window.performance.mark(this.startMark);
		}
	}

	public reportProgress(props?: ITelemetryProperties, eventNameSuffix: string = "update"): void {
		this.reportEvent(eventNameSuffix, props);
	}

	private autoEnd() {
		// Event might have been cancelled or ended in the callback
		if (this.event && this.markers.end) {
			this.reportEvent("end");
		}
		this.performanceEndMark();
		this.event = undefined;
	}

	public end(props?: ITelemetryProperties): void {
		this.reportEvent("end", props);
		this.performanceEndMark();
		this.event = undefined;
	}

	private performanceEndMark() {
		if (this.startMark && this.event) {
			const endMark = `${this.event.eventName}-end`;
			window.performance.mark(endMark);
			window.performance.measure(`${this.event.eventName}`, this.startMark, endMark);
			this.startMark = undefined;
		}
	}

	public cancel(props?: ITelemetryProperties, error?: any): void {
		if (this.markers.cancel !== undefined) {
			this.reportEvent("cancel", { category: this.markers.cancel, ...props }, error);
		}
		this.event = undefined;
	}

	/**
	 * Report the event, if it hasn't already been reported.
	 */
	public reportEvent(eventNameSuffix: string, props?: ITelemetryProperties, error?: any) {
		// There are strange sequences involving multiple Promise chains
		// where the event can be cancelled and then later a callback is invoked
		// and the caller attempts to end directly, e.g. issue #3936. Just return.
		if (!this.event) {
			return;
		}

		const event: ITelemetryPerformanceEvent = { ...this.event, ...props };
		event.eventName = `${event.eventName}_${eventNameSuffix}`;
		if (eventNameSuffix !== "start") {
			event.duration = this.duration;
			if (this.startMemoryCollection) {
				const currentMemory = (performance as PerformanceWithMemory)?.memory
					?.usedJSHeapSize;
				const differenceInKBytes = Math.floor(
					(currentMemory - this.startMemoryCollection) / 1024,
				);
				if (differenceInKBytes > 0) {
					event.usedJSHeapSize = differenceInKBytes;
				}
			}
		} else if (this.recordHeapSize) {
			this.startMemoryCollection = (
				performance as PerformanceWithMemory
			)?.memory?.usedJSHeapSize;
		}

		this.logger.sendPerformanceEvent(event, error);
	}
}

/**
 * Logger that is useful for UT
 * It can be used in places where logger instance is required, but events should be not send over.
 * @deprecated - Use createChildLogger instead
 */
export class TelemetryUTLogger implements ITelemetryLoggerExt {
	public send(event: ITelemetryBaseEvent): void {}
	public sendTelemetryEvent(event: ITelemetryGenericEvent, error?: any) {}
	public sendErrorEvent(event: ITelemetryErrorEvent, error?: any) {
		this.reportError("errorEvent in UT logger!", event, error);
	}
	public sendPerformanceEvent(event: ITelemetryPerformanceEvent, error?: any): void {}
	public logGenericError(eventName: string, error: any) {
		this.reportError(`genericError in UT logger!`, { eventName }, error);
	}
	public logException(event: ITelemetryErrorEvent, exception: any): void {
		this.reportError("exception in UT logger!", event, exception);
	}
	public debugAssert(condition: boolean, event?: ITelemetryErrorEvent): void {
		this.reportError("debugAssert in UT logger!");
	}
	public shipAssert(condition: boolean, event?: ITelemetryErrorEvent): void {
		this.reportError("shipAssert in UT logger!");
	}

	private reportError(message: string, event?: ITelemetryErrorEvent, err?: any) {
		const error = new Error(message);
		(error as any).error = error;
		(error as any).event = event;
		// report to console as exception can be eaten
		console.error(message);
		console.error(error);
		throw error;
	}
}

/**
 * Null logger
 * It can be used in places where logger instance is required, but events should be not send over.
 * @deprecated - for internal use only
 */
export class BaseTelemetryNullLogger implements ITelemetryBaseLogger {
	/**
	 * Send an event with the logger
	 *
	 * @param event - the event to send
	 */
	public send(event: ITelemetryBaseEvent): void {
		return;
	}
}

/**
 * Null logger
 * It can be used in places where logger instance is required, but events should be not send over.
 * @deprecated - for internal use only
 */
export class TelemetryNullLogger implements ITelemetryLoggerExt {
	public send(event: ITelemetryBaseEvent): void {}
	public sendTelemetryEvent(event: ITelemetryGenericEvent, error?: any): void {}
	public sendErrorEvent(event: ITelemetryErrorEvent, error?: any): void {}
	public sendPerformanceEvent(event: ITelemetryPerformanceEvent, error?: any): void {}
}

/**
 * Takes in an event object, and converts all of its values to a basePropertyType.
 * In the case of an invalid property type, the value will be converted to an error string.
 * @param event - Event with fields you want to stringify.
 */
function convertToBaseEvent({
	category,
	eventName,
	...props
}: ITelemetryEventExt): ITelemetryBaseEvent {
	const newEvent: ITelemetryBaseEvent = { category, eventName };
	for (const key of Object.keys(props)) {
		newEvent[key] = convertToBasePropertyType(props[key]);
	}
	return newEvent;
}

/**
 * Takes in value, and does one of 4 things.
 * if value is of primitive type - returns the original value.
 * If the value is an array of primitives - returns a stringified version of the array.
 * If the value is an object of type ITaggedTelemetryPropertyType - returns the object
 * with its values recursively converted to base property Type.
 * If none of these cases are reached - returns an error string
 * @param x - value passed in to convert to a base property type
 */
export function convertToBasePropertyType(
	x: TelemetryEventPropertyTypeExt | ITaggedTelemetryPropertyTypeExt,
): TelemetryEventPropertyType | ITaggedTelemetryPropertyType {
	return isTaggedTelemetryPropertyValue(x)
		? {
				value: convertToBasePropertyTypeUntagged(x.value),
				tag: x.tag,
		  }
		: convertToBasePropertyTypeUntagged(x);
}

function convertToBasePropertyTypeUntagged(
	x: TelemetryEventPropertyTypeExt,
): TelemetryEventPropertyType {
	switch (typeof x) {
		case "string":
		case "number":
		case "boolean":
		case "undefined":
			return x;
		case "object":
			// We assume this is an array or flat object based on the input types
			return JSON.stringify(x);
		default:
			// should never reach this case based on the input types
			console.error(
				`convertToBasePropertyTypeUntagged: INVALID PROPERTY (typed as ${typeof x})`,
			);
			return `INVALID PROPERTY (typed as ${typeof x})`;
	}
}

export const tagData = <
	T extends TelemetryDataTag,
	V extends Record<string, TelemetryEventPropertyTypeExt>,
>(
	tag: T,
	values: V,
) =>
	(Object.entries(values) as [keyof V, V[keyof V]][])
		.filter((e): e is [keyof V, Exclude<V[keyof V], undefined>] => e[1] !== undefined)
		.reduce<{
			[P in keyof V]:
				| (V[P] extends undefined ? undefined : never)
				| { value: Exclude<V[P], undefined>; tag: T };
		}>((pv, cv) => {
			pv[cv[0]] = { tag, value: cv[1] };
			return pv;
		}, {} as any);

export const tagCodeArtifacts = <T extends Record<string, TelemetryEventPropertyTypeExt>>(
	values: T,
) => tagData(TelemetryDataTag.CodeArtifact, values);
