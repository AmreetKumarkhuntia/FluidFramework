/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import fs from "fs";
import { createChildLogger } from "@fluidframework/telemetry-utils";
import { TestDriverTypes } from "@fluidframework/test-driver-definitions";
import {
	getUnexpectedLogErrorException,
	ITestObjectProvider,
	TestObjectProvider,
} from "@fluidframework/test-utils";
import { CompatKind, driver, r11sEndpointName, tenantIndex } from "../compatOptions.cjs";
import { configList } from "./compatConfig.js";
import { getVersionedTestObjectProvider } from "./compatUtils.js";
import { baseVersion } from "./baseVersion.js";
import { ITestObjectProviderOptions } from "./describeCompat.js";

/*
 * Types of documents to be used during the performance runs.
 */
export type DocumentType =
	/** Document with a SharedMap */
	| "DocumentMap"
	/** Document with Multiple DataStores */
	| "DocumentMultipleDataStores"
	/** Document with a SharedMatrix */
	| "DocumentMatrix";

export interface DocumentMapInfo {
	numberOfItems: number;
	itemSizeMb: number;
}

export interface DocumentMultipleDataStoresInfo {
	numberDataStores: number;
	numberDataStoresPerIteration: number;
}

export interface DocumentMatrixInfo {
	rowSize: number;
	columnSize: number;
	stringSize: number;
}

export type DocumentTypeInfo =
	| DocumentMapInfo
	| DocumentMultipleDataStoresInfo
	| DocumentMatrixInfo;

export interface IE2EDocsConfig {
	documents: DescribeE2EDocInfo[];
}
// Default document types to be used during the performance E2E runs.
const E2EDefaultDocumentTypes: DescribeE2EDocInfo[] = [
	{
		testTitle: "10Mb Map",
		documentType: "DocumentMap",
		documentTypeInfo: {
			numberOfItems: 2,
			itemSizeMb: 5, // 5Mb
		},
		minSampleCount: 2,
		supportedEndpoints: ["local", "odsp"],
	},
	{
		testTitle: "5Mb Map",
		documentType: "DocumentMap",
		documentTypeInfo: {
			numberOfItems: 1,
			itemSizeMb: 5, // 5Mb
		},
		minSampleCount: 2,
		supportedEndpoints: ["local", "odsp"],
	},
	{
		testTitle: "250 DataStores - 750 DDSs",
		documentType: "DocumentMultipleDataStores",
		documentTypeInfo: {
			numberDataStores: 250,
			numberDataStoresPerIteration: 250,
		},
		minSampleCount: 1,
	},
	{
		testTitle: "500 DataStores - 1500 DDSs",
		documentType: "DocumentMultipleDataStores",
		documentTypeInfo: {
			numberDataStores: 500,
			numberDataStoresPerIteration: 250,
		},
		minSampleCount: 1,
	},
	{
		testTitle: "Matrix 10x10 with SharedStrings",
		documentType: "DocumentMatrix",
		documentTypeInfo: {
			rowSize: 10,
			columnSize: 10,
			stringSize: 100,
		},
		minSampleCount: 2,
	},
	{
		testTitle: "Matrix 100x100 with SharedStrings",
		documentType: "DocumentMatrix",
		documentTypeInfo: {
			rowSize: 100,
			columnSize: 100,
			stringSize: 100,
		},
		minSampleCount: 2,
	},
];

export type BenchmarkType = "ExecutionTime" | "MemoryUsage";
export type BenchmarkTypeDescription = "Runtime benchmarks" | "Memory benchmarks";

export interface DescribeE2EDocInfo {
	testTitle: string;
	documentType: DocumentType;
	documentTypeInfo: DocumentTypeInfo;
	supportedEndpoints?: TestDriverTypes[];
	/**
	 * Minimum number of iterations when running performance tests against the document.
	 */
	minSampleCount?: number;
}

export function isDocumentMapInfo(info: DocumentTypeInfo): info is DocumentMapInfo {
	return (info as DocumentMapInfo).numberOfItems !== undefined;
}

export function isDocumentMultipleDataStoresInfo(
	info: DocumentTypeInfo,
): info is DocumentMultipleDataStoresInfo {
	return (info as DocumentMultipleDataStoresInfo).numberDataStores !== undefined;
}

export function isDocumentMatrixInfo(info: DocumentTypeInfo): info is DocumentMatrixInfo {
	return (info as DocumentMatrixInfo).rowSize !== undefined;
}

export function assertDocumentTypeInfo(
	info: DocumentTypeInfo,
	type: DocumentType,
): asserts info is DocumentMapInfo | DocumentMultipleDataStoresInfo {
	switch (type) {
		case "DocumentMap":
			if (!isDocumentMapInfo(info)) {
				throw new Error(`Expected DocumentMapInfo but got ${JSON.stringify(info)}`);
			}
			break;
		case "DocumentMultipleDataStores":
			if (!isDocumentMultipleDataStoresInfo(info)) {
				throw new Error(
					`Expected DocumentMultipleDataStoresInfo but got ${JSON.stringify(info)}`,
				);
			}
			break;
		case "DocumentMatrix":
			if (!isDocumentMatrixInfo(info)) {
				throw new Error(`Expected DocumentMatrixInfo but got ${JSON.stringify(info)}`);
			}
			break;
		default:
			throw new Error(`Unexpected DocumentType: ${type}`);
	}
}

export interface DescribeE2EDocInfoWithBenchmarkType extends DescribeE2EDocInfo {
	benchmarkType: BenchmarkType;
}

export type DescribeE2EDocSuite = (
	title: string,
	tests: (
		this: Mocha.Suite,
		provider: (options?: ITestObjectProviderOptions) => ITestObjectProvider,
		documentType: () => DescribeE2EDocInfo,
	) => void,
	docTypes?: DescribeE2EDocInfo[],
	testType?: string,
) => Mocha.Suite | void;

function getE2EConfigFile(): IE2EDocsConfig | undefined {
	let config: IE2EDocsConfig | undefined;
	try {
		const localDebugPath = "./e2eDocsConfig.json";
		if (fs.existsSync(localDebugPath)) {
			config = JSON.parse(fs.readFileSync(localDebugPath, "utf-8"));
		} else {
			const childArgs = [...process.execArgv, ...process.argv.slice(1)];
			const flagIndex = childArgs.indexOf("--e2eConfigFile");
			if (flagIndex > 0) {
				const configPath = childArgs[flagIndex + 1];
				if (!fs.existsSync(configPath)) {
					console.log("Could not locate e2eDocsConfig.json used on the command line.");
				}
				config = JSON.parse(fs.readFileSync(childArgs[flagIndex + 1], "utf-8"));
			}
		}
	} catch (e) {
		console.log("Could not locate e2eDocsConfig.json - continuing");
	}
	return config;
}

function createE2EDocsDescribe(docTypes?: DescribeE2EDocInfo[]): DescribeE2EDocSuite {
	const config = getE2EConfigFile();

	const d: DescribeE2EDocSuite = (title, tests, testType) => {
		describe(
			`${testType} -`,
			createE2EDocCompatSuite(
				title,
				tests,
				docTypes ?? config?.documents ?? E2EDefaultDocumentTypes,
			),
		);
	};
	return d;
}

function createE2EDocsDescribeWithType(testType: BenchmarkTypeDescription): DescribeE2EDocSuite {
	const config = getE2EConfigFile();

	const d: DescribeE2EDocSuite = (title, tests, docTypes) => {
		describe(
			`${testType} -`,
			createE2EDocCompatSuite(
				title,
				tests,
				docTypes === undefined ? config?.documents ?? E2EDefaultDocumentTypes : docTypes,
			),
		);
	};
	return d;
}

function createE2EDocCompatSuite(
	title: string,
	tests: (
		this: Mocha.Suite,
		provider: () => ITestObjectProvider,
		documentType: () => DescribeE2EDocInfo,
	) => void,
	docTypes: DescribeE2EDocInfo[],
) {
	const compatFilter: CompatKind[] = [CompatKind.None];
	let configs = configList.value;
	configs = configs.filter((value) => compatFilter.includes(value.kind));

	return function (this: Mocha.Suite) {
		for (const config of configs) {
			for (const doctype of docTypes) {
				const name = `${title} - ${doctype.testTitle}`;
				describe(name, function () {
					let provider: TestObjectProvider;
					let resetAfterEach: boolean;
					before(async function () {
						try {
							provider = await getVersionedTestObjectProvider(
								baseVersion,
								config.loader,
								{
									type: driver,
									version: config.driver,
									config: {
										r11s: { r11sEndpointName },
										odsp: { tenantIndex },
									},
								},
								config.containerRuntime,
								config.dataRuntime,
							);
						} catch (error) {
							const logger = createChildLogger({
								logger: getTestLogger?.(),
								namespace: "DescribeE2EDocs",
							});
							logger.sendErrorEvent(
								{
									eventName: "TestObjectProviderLoadFailed",
									driverType: driver,
								},
								error,
							);
							throw error;
						}

						Object.defineProperty(this, "__fluidTestProvider", { get: () => provider });
					});
					tests.bind(this)(
						(options?: ITestObjectProviderOptions) => {
							resetAfterEach = options?.resetAfterEach ?? true;
							if (options?.syncSummarizer === true) {
								provider.resetLoaderContainerTracker(
									true /* syncSummarizerClients */,
								);
							}
							return provider;
						},
						() => {
							return doctype;
						},
					);

					afterEach(function (done: Mocha.Done) {
						// if the test failed for another reason
						// then we don't need to check errors
						// and fail the after each as well
						if (this.currentTest?.state === "passed") {
							const logErrors = getUnexpectedLogErrorException(provider.logger);
							done(logErrors);
						} else {
							done();
						}
						if (resetAfterEach) {
							provider.reset();
						}
					});
				});
			}
		}
	};
}

export const describeE2EDocs: DescribeE2EDocSuite = createE2EDocsDescribe();

export const describeE2EDocsRuntime: DescribeE2EDocSuite =
	createE2EDocsDescribeWithType("Runtime benchmarks");

export const describeE2EDocsMemory: DescribeE2EDocSuite =
	createE2EDocsDescribeWithType("Memory benchmarks");

export function isMemoryTest(): boolean {
	let isMemoryUsageTest: boolean = false;
	const childArgs = [...process.execArgv, ...process.argv.slice(1)];
	for (const flag of ["--grep", "--fgrep"]) {
		const flagIndex = childArgs.indexOf(flag);
		if (flagIndex > 0) {
			isMemoryUsageTest = childArgs[flagIndex + 1] === "@MemoryUsage" ? true : false;
			break;
		}
	}
	const isMemTest: boolean =
		process.env.FLUID_E2E_MEMORY !== undefined ? true : isMemoryUsageTest ?? false;
	return isMemTest;
}

export const describeE2EDocRun: DescribeE2EDocSuite = createE2EDocsDescribeRun();
export const getCurrentBenchmarkType = (currentType: DescribeE2EDocSuite): BenchmarkType => {
	return currentType === describeE2EDocsMemory ? "MemoryUsage" : "ExecutionTime";
};

function createE2EDocsDescribeRun(): DescribeE2EDocSuite {
	return isMemoryTest() === true ? describeE2EDocsMemory : describeE2EDocsRuntime;
}
