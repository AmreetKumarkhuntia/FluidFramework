/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */
import { strict as assert } from "assert";
import Table from "easy-table";
import { isInPerformanceTestingMode } from "@fluid-tools/benchmark";
import { ISequencedDocumentMessage } from "@fluidframework/protocol-definitions";
import { emptyField, FieldKinds, namedTreeSchema, singleTextCursor } from "../../feature-libraries";
import { ISharedTree } from "../../shared-tree";
import { brand, getOrAddEmptyToMap } from "../../util";
import { TestTreeProviderLite } from "../utils";
import {
	FieldKey,
	fieldSchema,
	JsonableTree,
	moveToDetachedField,
	rootFieldKey,
	SchemaData,
	Value,
	ValueSchema,
} from "../../core";

const stringSchema = namedTreeSchema({
	name: brand("String"),
	mapFields: emptyField,
	leafValue: ValueSchema.String,
});

export const childSchema = namedTreeSchema({
	name: brand("Test:Opsize-Bench-Child"),
	structFields: {
		data: fieldSchema(FieldKinds.value, [stringSchema.name]),
	},
	mapFields: emptyField,
});

export const parentSchema = namedTreeSchema({
	name: brand("Test:Opsize-Bench-Root"),
	structFields: {
		children: fieldSchema(FieldKinds.sequence, [childSchema.name]),
	},
	mapFields: emptyField,
});

export const rootSchema = fieldSchema(FieldKinds.value, [parentSchema.name]);

export const fullSchemaData: SchemaData = {
	treeSchema: new Map([
		[stringSchema.name, stringSchema],
		[parentSchema.name, parentSchema],
	]),
	rootFieldSchema: rootSchema,
};

const initialTestJsonTree = {
	type: parentSchema.name,
	fields: {
		children: [],
	},
};

const childrenFieldKey: FieldKey = brand("children");

/*
 * Updates the given `tree` to the given `schema` and inserts `state` as its root.
 */
function initializeTestTree(tree: ISharedTree, state: JsonableTree = initialTestJsonTree) {
	tree.storedSchema.update(fullSchemaData);
	// inserts a node with the initial AppState as the root of the tree
	const writeCursor = singleTextCursor(state);
	const field = tree.editor.sequenceField({ parent: undefined, field: rootFieldKey });
	field.insert(0, writeCursor);
}

const getJsonNode = (desiredByteSize: number): JsonableTree => {
	const node = {
		type: childSchema.name,
		fields: {
			data: [{ value: "", type: stringSchema.name }],
		},
	};

	const initialNodeByteSize = new TextEncoder().encode(JSON.stringify(node)).length;
	const sizeIncrementor = "a"; // 1 byte
	const remainingByteSizeToAdd = desiredByteSize - initialNodeByteSize;
	node.fields.data[0].value = sizeIncrementor.repeat(remainingByteSizeToAdd);
	return node;
};

const getChildrenlength = (tree: ISharedTree) => {
	const cursor = tree.forest.allocateCursor();
	moveToDetachedField(tree.forest, cursor);
	cursor.enterNode(0);
	cursor.enterField(childrenFieldKey);
	const length = cursor.getFieldLength();
	cursor.free();
	return length;
};

const assertChildNodeCount = (tree: ISharedTree, nodeCount: number) => {
	const cursor = tree.forest.allocateCursor();
	moveToDetachedField(tree.forest, cursor);
	cursor.enterNode(0);
	cursor.enterField(childrenFieldKey);
	assert.equal(cursor.getFieldLength(), nodeCount);
	cursor.free();
};

const assertChildValuesEqualExpected = (
	tree: ISharedTree,
	editPayload: Value,
	childCount: number,
) => {
	const cursor = tree.forest.allocateCursor();
	moveToDetachedField(tree.forest, cursor);
	cursor.enterNode(0);
	cursor.enterField(childrenFieldKey);
	cursor.enterNode(0);
	assert.equal(cursor.value, editPayload);

	let currChildCount = 1;
	while (cursor.nextNode() && currChildCount < childCount) {
		assert.equal(cursor.value, editPayload);
		currChildCount++;
	}
	cursor.free();
};

// Creates a json tree with the desired number of children and the size of each child in bytes.
const getInitialJsonTreeWithChildren = (numChildNodes: number, childNodeByteSize: number) => {
	const childNode = getJsonNode(childNodeByteSize);
	const jsonTree: JsonableTree = {
		type: parentSchema.name,
		fields: {
			children: [],
		},
	};
	for (let i = 0; i < numChildNodes; i++) {
		jsonTree.fields?.children?.push({ ...childNode });
	}
	return jsonTree;
};

const insertNodesWithIndividualTransactions = (
	tree: ISharedTree,
	provider: TestTreeProviderLite,
	jsonNode: JsonableTree,
	count: number,
) => {
	for (let i = 0; i < count; i++) {
		tree.transaction.start();
		const path = {
			parent: undefined,
			parentField: rootFieldKey,
			parentIndex: 0,
		};
		const writeCursor = singleTextCursor(jsonNode);
		const field = tree.editor.sequenceField({ parent: path, field: childrenFieldKey });
		field.insert(0, writeCursor);
		tree.transaction.commit();
	}
	provider.processMessages();
};

const insertNodesWithSingleTransaction = (
	tree: ISharedTree,
	provider: TestTreeProviderLite,
	jsonNode: JsonableTree,
	count: number,
) => {
	tree.transaction.start();
	const path = {
		parent: undefined,
		parentField: rootFieldKey,
		parentIndex: 0,
	};
	const field = tree.editor.sequenceField({ parent: path, field: childrenFieldKey });
	for (let i = 0; i < count; i++) {
		field.insert(0, singleTextCursor(jsonNode));
	}
	tree.transaction.commit();
	provider.processMessages();
};

const deleteNodesWithIndividualTransactions = (
	tree: ISharedTree,
	provider: TestTreeProviderLite,
	numDeletes: number,
	deletesPerTransaction: number,
) => {
	for (let i = 0; i < numDeletes; i++) {
		tree.transaction.start();
		const path = {
			parent: undefined,
			parentField: rootFieldKey,
			parentIndex: 0,
		};
		const field = tree.editor.sequenceField({ parent: path, field: childrenFieldKey });
		field.delete(getChildrenlength(tree) - 1, deletesPerTransaction);
		tree.transaction.commit();
		provider.processMessages();
	}
};

const deleteNodesWithSingleTransaction = (
	tree: ISharedTree,
	provider: TestTreeProviderLite,
	numDeletes: number,
) => {
	tree.transaction.start();
	const path = {
		parent: undefined,
		parentField: rootFieldKey,
		parentIndex: 0,
	};
	const field = tree.editor.sequenceField({ parent: path, field: childrenFieldKey });
	field.delete(0, numDeletes);
	tree.transaction.commit();
	provider.processMessages();
};

const getEditPayloadInBytes = (numBytes: number) => {
	let payload = "";
	while (payload.length < numBytes) {
		payload += "a";
	}
	return payload;
};

const editNodesWithIndividualTransactions = (
	tree: ISharedTree,
	provider: TestTreeProviderLite,
	numChildrenToEdit: number,
	editPayload: Value,
) => {
	const rootPath = {
		parent: undefined,
		parentField: rootFieldKey,
		parentIndex: 0,
	};
	const editor = tree.editor.sequenceField({ parent: rootPath, field: childrenFieldKey });
	for (let i = 0; i < numChildrenToEdit; i++) {
		tree.transaction.start();
		editor.delete(i, 1);
		editor.insert(
			i,
			singleTextCursor({
				type: childSchema.name,
				value: editPayload,
				fields: {
					data: [{ value: "", type: stringSchema.name }],
				},
			}),
		);
		tree.transaction.commit();
		provider.processMessages();
	}
};

const editNodesWithSingleTransaction = (
	tree: ISharedTree,
	provider: TestTreeProviderLite,
	numChildrenToEdit: number,
	editPayload: Value,
) => {
	const rootPath = {
		parent: undefined,
		parentField: rootFieldKey,
		parentIndex: 0,
	};
	const editor = tree.editor.sequenceField({ parent: rootPath, field: childrenFieldKey });
	tree.transaction.start();
	for (let i = 0; i < numChildrenToEdit; i++) {
		editor.delete(i, 1);
		editor.insert(
			i,
			singleTextCursor({
				type: childSchema.name,
				value: editPayload,
				fields: {
					data: [{ value: "", type: stringSchema.name }],
				},
			}),
		);
	}
	tree.transaction.commit();
	provider.processMessages();
};

/**
 * The following byte sizes in utf-8 encoded bytes of JsonableTree were found to be the maximum size that could be successfully
 * inserted/deleted/edited using the following node counts and either individual of singular (bulk) transactions.
 *
 * Using any larger of a byte size of JsonableTree children causes the "BatchToLarge" error; this would require either:
 * Adding artificial wait, for e.x. by using a for-loop to segment our transactions into batches of less than the given node count.
 * OR
 * Making the size in bytes of the children smaller.
 */
const MAX_SUCCESSFUL_OP_BYTE_SIZES = {
	INSERT: {
		INDIVIDUAL: {
			nodeCounts: {
				"100": 8900,
			},
		},
		SINGLE: {
			nodeCounts: {
				"100": 9600,
			},
		},
	},
	DELETE: {
		INDIVIDUAL: {
			nodeCounts: {
				"100": 9700,
			},
		},
		SINGLE: {
			nodeCounts: {
				"100": 9700,
			},
		},
	},
	EDIT: {
		INDIVIDUAL: {
			nodeCounts: {
				// Edit benchmarks use 1/10 of the actual max sizes outside of perf mode because it takes so long to execute.
				"100": isInPerformanceTestingMode ? 800000 : 80000,
			},
		},
		SINGLE: {
			nodeCounts: {
				"100": 8600,
			},
		},
	},
} as const;

const getSuccessfulOpByteSize = (
	operation: "INSERT" | "DELETE" | "EDIT",
	transactionStyle: "INDIVIDUAL" | "SINGLE",
	percentile: number,
) => {
	return Math.floor(
		MAX_SUCCESSFUL_OP_BYTE_SIZES[operation][transactionStyle].nodeCounts["100"] * percentile,
	);
};

const BENCHMARK_NODE_COUNT = 100;

describe("SharedTree Op Size Benchmarks", () => {
	const opsByBenchmarkName: Map<string, ISequencedDocumentMessage[]> = new Map();
	let currentBenchmarkName = "";
	const currentTestOps: ISequencedDocumentMessage[] = [];

	const registerOpListener = (
		provider: TestTreeProviderLite,
		resultArray: ISequencedDocumentMessage[],
	) => {
		provider.trees[0].on("op", (message) => {
			if (message?.type === "op") {
				resultArray.push(message);
			}
		});
	};

	const getOperationsStats = (operations: ISequencedDocumentMessage[]) => {
		if (operations.length === 0) {
			return {
				"Avg. Op Size (Bytes)": 0,
				"Max Op Size (Bytes)": 0,
				"Min Op Size (Bytes)": 0,
				"Total Ops:": 0,
			};
		}
		let averageOpSizeBytes = 0;
		operations.forEach((operation) => {
			averageOpSizeBytes += new TextEncoder().encode(JSON.stringify(operation)).length;
		});
		averageOpSizeBytes = averageOpSizeBytes / operations.length;

		let maxOpSizeBytes = new TextEncoder().encode(JSON.stringify(operations[0])).length;
		operations.forEach(
			(operation) =>
				(maxOpSizeBytes = Math.max(
					new TextEncoder().encode(JSON.stringify(operation)).length,
					maxOpSizeBytes,
				)),
		);

		let minOpSizeBytes = new TextEncoder().encode(JSON.stringify(operations[0])).length;
		operations.forEach(
			(operation) =>
				(minOpSizeBytes = Math.min(
					new TextEncoder().encode(JSON.stringify(operation)).length,
					minOpSizeBytes,
				)),
		);

		return {
			"Avg. Op Size (Bytes)": Number.parseFloat(averageOpSizeBytes.toFixed(2)),
			"Max Op Size (Bytes)": maxOpSizeBytes,
			"Min Op Size (Bytes)": minOpSizeBytes,
			"Total Ops:": operations.length,
		};
	};

	const initializeOpDataCollection = (provider: TestTreeProviderLite, testName: string) => {
		currentBenchmarkName = testName;
		currentTestOps.length = 0;
		registerOpListener(provider, currentTestOps);
	};

	const saveAndResetCurrentOps = () => {
		currentTestOps.forEach((op) =>
			getOrAddEmptyToMap(opsByBenchmarkName, currentBenchmarkName).push(op),
		);
		currentTestOps.length = 0;
	};

	const deleteCurrentOps = () => {
		currentTestOps.length = 0;
	};

	afterEach(() => {
		currentTestOps.forEach((op) =>
			getOrAddEmptyToMap(opsByBenchmarkName, currentBenchmarkName).push(op),
		);
		currentTestOps.length = 0;
	});

	after(() => {
		const allBenchmarkOpStats: any[] = [];
		for (const [benchmarkName, ops] of opsByBenchmarkName) {
			allBenchmarkOpStats.push({
				"Test name": benchmarkName,
				...getOperationsStats(ops),
			});
		}
		const table = new Table();
		allBenchmarkOpStats.forEach((data) => {
			Object.keys(data).forEach((key) => table.cell(key, data[key]));
			table.newRow();
		});
		table.sort(["Avg. Op Size (Bytes)|des"]);

		console.log("-- Op Size Benchmark Statistics Sorted by Avg. Op Size -- ");
		console.log(table.toString());
	});

	describe("1. Insert Nodes", () => {
		describe("1a. With Individual transactions", () => {
			const benchmarkInsertNodesWithIndividualTxs = (
				percentile: number,
				testName: string,
			) => {
				const provider = new TestTreeProviderLite();
				initializeOpDataCollection(provider, testName);
				initializeTestTree(provider.trees[0]);
				deleteCurrentOps(); // We don't want to record any ops from initializing the tree.
				const jsonNode = getJsonNode(
					getSuccessfulOpByteSize("INSERT", "INDIVIDUAL", percentile),
				);
				insertNodesWithIndividualTransactions(
					provider.trees[0],
					provider,
					jsonNode,
					BENCHMARK_NODE_COUNT,
				);
				assertChildNodeCount(provider.trees[0], BENCHMARK_NODE_COUNT);
			};

			it(`1a.a. [Insert] [Individual Txs] ${BENCHMARK_NODE_COUNT} small nodes in ${BENCHMARK_NODE_COUNT} transactions`, () => {
				benchmarkInsertNodesWithIndividualTxs(
					0.01,
					`1a.a. [Insert] [Individual Txs] ${BENCHMARK_NODE_COUNT} small nodes in ${BENCHMARK_NODE_COUNT} individual transactions`,
				);
			});

			it(`1a.b. [Insert] [Individual Txs] ${BENCHMARK_NODE_COUNT} medium nodes in ${BENCHMARK_NODE_COUNT} individual transactions`, () => {
				benchmarkInsertNodesWithIndividualTxs(
					0.5,
					`1a.b. [Insert] [Individual Txs] ${BENCHMARK_NODE_COUNT} medium nodes in ${BENCHMARK_NODE_COUNT} individual transactions`,
				);
			});

			it(`1a.c. [Insert] [Individual Txs] ${BENCHMARK_NODE_COUNT} large nodes in ${BENCHMARK_NODE_COUNT} individual transactions`, () => {
				benchmarkInsertNodesWithIndividualTxs(
					1,
					`1a.c. [Insert] [Individual Txs] ${BENCHMARK_NODE_COUNT} large nodes in ${BENCHMARK_NODE_COUNT} individual transactions`,
				);
			});
		});

		describe("1b. With Single transaction", () => {
			const benchmarkInsertNodesWithSingleTx = (percentile: number, testName: string) => {
				const provider = new TestTreeProviderLite();
				initializeOpDataCollection(provider, testName);
				initializeTestTree(provider.trees[0]);
				deleteCurrentOps(); // We don't want to record any ops from initializing the tree.
				const jsonNode = getJsonNode(
					getSuccessfulOpByteSize("INSERT", "SINGLE", percentile),
				);
				insertNodesWithSingleTransaction(
					provider.trees[0],
					provider,
					jsonNode,
					BENCHMARK_NODE_COUNT,
				);
				assertChildNodeCount(provider.trees[0], BENCHMARK_NODE_COUNT);
			};

			it(`1b.a. [Insert] [Single Tx] ${BENCHMARK_NODE_COUNT} small nodes in 1 transaction`, () => {
				benchmarkInsertNodesWithSingleTx(
					0.01,
					`1b.a. [Insert] [Single Tx] ${BENCHMARK_NODE_COUNT} small nodes in 1 transaction`,
				);
			});

			it(`1b.b. [Insert] [Single Tx] ${BENCHMARK_NODE_COUNT} medium nodes in 1 transaction`, () => {
				benchmarkInsertNodesWithSingleTx(
					0.5,
					`1b.b. [Insert] [Single Tx] ${BENCHMARK_NODE_COUNT} medium nodes in 1 transaction`,
				);
			});

			it(`1b.c. [Insert] [Single Tx] ${BENCHMARK_NODE_COUNT} large nodes in 1 transaction`, () => {
				benchmarkInsertNodesWithSingleTx(
					1,
					`1b.c. [Insert] [Single Tx] ${BENCHMARK_NODE_COUNT} large nodes in 1 transaction`,
				);
			});
		});
	});

	describe("2. Delete Nodes", () => {
		describe("2a. With Individual transactions", () => {
			const benchmarkDeleteNodesWithIndividualTxs = (
				percentile: number,
				testName: string,
			) => {
				const provider = new TestTreeProviderLite();
				initializeOpDataCollection(provider, testName);
				const childByteSize = getSuccessfulOpByteSize("DELETE", "INDIVIDUAL", percentile);
				initializeTestTree(
					provider.trees[0],
					getInitialJsonTreeWithChildren(100, childByteSize),
				);
				deleteCurrentOps(); // We don't want to record any ops from initializing the tree.
				deleteNodesWithIndividualTransactions(provider.trees[0], provider, 100, 1);
				assertChildNodeCount(provider.trees[0], 0);
			};

			it(`2a.a. [Delete] [Individual Txs] ${BENCHMARK_NODE_COUNT} small nodes in ${BENCHMARK_NODE_COUNT} individual transactions`, () => {
				benchmarkDeleteNodesWithIndividualTxs(
					0.01,
					`2a.a. [Delete] [Individual Txs] ${BENCHMARK_NODE_COUNT} small nodes in ${BENCHMARK_NODE_COUNT} individual transactions`,
				);
			});

			it(`2a.b. [Delete] [Individual Txs] ${BENCHMARK_NODE_COUNT} medium nodes in ${BENCHMARK_NODE_COUNT} individual transactions`, () => {
				benchmarkDeleteNodesWithIndividualTxs(
					0.5,
					`2a.b. [Delete] [Individual Txs] ${BENCHMARK_NODE_COUNT} medium nodes in ${BENCHMARK_NODE_COUNT} individual transactions`,
				);
			});

			it(`2a.c. [Delete] [Individual Txs] ${BENCHMARK_NODE_COUNT} large nodes in ${BENCHMARK_NODE_COUNT} individual transactions`, () => {
				benchmarkDeleteNodesWithIndividualTxs(
					1,
					`2a.c. [Delete] [Individual Txs] ${BENCHMARK_NODE_COUNT} large nodes in ${BENCHMARK_NODE_COUNT} individual transactions`,
				);
			});
		});

		describe("2b. With Single transaction", () => {
			const benchmarkDeleteNodesWithSingleTx = (percentile: number, testName: string) => {
				const provider = new TestTreeProviderLite();
				initializeOpDataCollection(provider, testName);
				const childByteSize = getSuccessfulOpByteSize("DELETE", "SINGLE", percentile);
				initializeTestTree(
					provider.trees[0],
					getInitialJsonTreeWithChildren(100, childByteSize),
				);
				deleteCurrentOps(); // We don't want to record any ops from initializing the tree.
				deleteNodesWithSingleTransaction(provider.trees[0], provider, 100);
				assertChildNodeCount(provider.trees[0], 0);
			};

			it(`2b.a. [Delete] [Single Tx] ${BENCHMARK_NODE_COUNT} small nodes in 1 transaction containing 1 delete of ${BENCHMARK_NODE_COUNT} nodes`, () => {
				benchmarkDeleteNodesWithSingleTx(
					0.01,
					`2b.a. [Delete] [Single Tx] ${BENCHMARK_NODE_COUNT} small nodes in 1 transaction containing 1 delete of ${BENCHMARK_NODE_COUNT} nodes`,
				);
			});

			it(`2b.b. [Delete] [Single Tx] ${BENCHMARK_NODE_COUNT} medium nodes in 1 transactions containing 1 delete of ${BENCHMARK_NODE_COUNT} nodes`, () => {
				benchmarkDeleteNodesWithSingleTx(
					0.5,
					`2b.b. [Delete] [Single Tx] ${BENCHMARK_NODE_COUNT} medium nodes in 1 transactions containing 1 delete of ${BENCHMARK_NODE_COUNT} nodes`,
				);
			});

			it(`2b.c. [Delete] [Single Tx] ${BENCHMARK_NODE_COUNT} large nodes in 1 transactions containing 1 delete of ${BENCHMARK_NODE_COUNT} nodes`, () => {
				benchmarkDeleteNodesWithSingleTx(
					1,
					`2b.c. [Delete] [Single Tx] ${BENCHMARK_NODE_COUNT} large nodes in 1 transactions containing 1 delete of ${BENCHMARK_NODE_COUNT} nodes`,
				);
			});
		});
	});

	describe("3. Edit Nodes", () => {
		describe("3a. With Individual transactions", () => {
			const benchmarkEditNodesWithIndividualTxs = (percentile: number, testName: string) => {
				const provider = new TestTreeProviderLite();
				initializeOpDataCollection(provider, testName);
				// Note that the child node byte size for the intial tree here should be arbitrary
				initializeTestTree(
					provider.trees[0],
					getInitialJsonTreeWithChildren(BENCHMARK_NODE_COUNT, 1000),
				);
				deleteCurrentOps(); // We don't want to record any ops from initializing the tree.
				const editPayload = getEditPayloadInBytes(
					getSuccessfulOpByteSize("EDIT", "INDIVIDUAL", percentile),
				);
				editNodesWithIndividualTransactions(
					provider.trees[0],
					provider,
					BENCHMARK_NODE_COUNT,
					editPayload,
				);
				assertChildValuesEqualExpected(
					provider.trees[0],
					editPayload,
					BENCHMARK_NODE_COUNT,
				);
			};

			it(`3a.a. [Edit] [Individual Txs] ${BENCHMARK_NODE_COUNT} small changes in ${BENCHMARK_NODE_COUNT} transactions containing 1 edit`, () => {
				benchmarkEditNodesWithIndividualTxs(
					0.01,
					`3a.a. [Edit] [Individual Txs] ${BENCHMARK_NODE_COUNT} small changes in ${BENCHMARK_NODE_COUNT} transactions containing 1 edit`,
				);
			});

			it(`3a.b. [Edit] [Individual Txs] ${BENCHMARK_NODE_COUNT} medium changes in ${BENCHMARK_NODE_COUNT} transactions containing 1 edit`, () => {
				benchmarkEditNodesWithIndividualTxs(
					0.5,
					`3a.b. [Edit] [Individual Txs] ${BENCHMARK_NODE_COUNT} medium changes in ${BENCHMARK_NODE_COUNT} transactions containing 1 edit`,
				);
			});

			it(`3a.c. [Edit] [Individual Txs] ${BENCHMARK_NODE_COUNT} large changes in ${BENCHMARK_NODE_COUNT} transactions containing 1 edit`, () => {
				benchmarkEditNodesWithIndividualTxs(
					1,
					`3a.c. [Edit] [Individual Txs] ${BENCHMARK_NODE_COUNT} large changes in ${BENCHMARK_NODE_COUNT} transactions containing 1 edit`,
				);
			});
		});

		describe("3b. With Single transaction", () => {
			const benchmarkEditNodesWithSingleTx = (percentile: number, testName: string) => {
				const provider = new TestTreeProviderLite();
				initializeOpDataCollection(provider, testName);
				// Note that the child node byte size for the intial tree here should be arbitrary
				initializeTestTree(
					provider.trees[0],
					getInitialJsonTreeWithChildren(BENCHMARK_NODE_COUNT, 1000),
				);
				deleteCurrentOps(); // We don't want to record any ops from initializing the tree.
				const editPayload = getEditPayloadInBytes(
					getSuccessfulOpByteSize("EDIT", "SINGLE", percentile),
				);
				editNodesWithSingleTransaction(
					provider.trees[0],
					provider,
					BENCHMARK_NODE_COUNT,
					editPayload,
				);
				assertChildValuesEqualExpected(
					provider.trees[0],
					editPayload,
					BENCHMARK_NODE_COUNT,
				);
			};

			it(`3b.a. [Edit] [Single Tx] ${BENCHMARK_NODE_COUNT} small edits in 1 transaction containing ${BENCHMARK_NODE_COUNT} edits`, () => {
				benchmarkEditNodesWithSingleTx(
					0.01,
					`3b.a. [Edit] [Single Tx] ${BENCHMARK_NODE_COUNT} small changes in 1 transaction containing ${BENCHMARK_NODE_COUNT} edits`,
				);
			});

			it(`3b.b. [Edit] [Single Tx] ${BENCHMARK_NODE_COUNT} medium changes in 1 transaction containing ${BENCHMARK_NODE_COUNT} edits`, () => {
				benchmarkEditNodesWithSingleTx(
					0.5,
					`3b.b. [Edit] [Single Tx] ${BENCHMARK_NODE_COUNT} medium changes in 1 transaction containing ${BENCHMARK_NODE_COUNT} edits`,
				);
			});

			it(`3b.c. [Edit] [Single Tx] ${BENCHMARK_NODE_COUNT} large changes in 1 transaction containing ${BENCHMARK_NODE_COUNT} edits`, () => {
				benchmarkEditNodesWithSingleTx(
					1,
					`3b.c. [Edit] [Single Tx] ${BENCHMARK_NODE_COUNT} large changes in 1 transaction containing ${BENCHMARK_NODE_COUNT} edits`,
				);
			});
		});
	});

	describe("4. Insert, Delete & Edit Nodes", () => {
		describe("4a. Insert, Delete & Edit Nodes in Individual Transactions", () => {
			const benchmarkInsertDeleteEditNodesWithInvidiualTxs = (
				percentile: number,
				testName: string,
				insertNodeCount: number,
				deleteNodeCount: number,
				editNodeCount: number,
			) => {
				const provider = new TestTreeProviderLite();
				initializeOpDataCollection(provider, testName);

				// delete
				const childByteSize = getSuccessfulOpByteSize("DELETE", "INDIVIDUAL", percentile);
				initializeTestTree(
					provider.trees[0],
					getInitialJsonTreeWithChildren(deleteNodeCount, childByteSize),
				);
				deleteCurrentOps(); // We don't want to record the ops from initializing the tree.
				deleteNodesWithIndividualTransactions(
					provider.trees[0],
					provider,
					deleteNodeCount,
					1,
				);
				assertChildNodeCount(provider.trees[0], 0);

				// insert
				const insertChildNode = getJsonNode(
					getSuccessfulOpByteSize("INSERT", "INDIVIDUAL", percentile),
				);
				insertNodesWithIndividualTransactions(
					provider.trees[0],
					provider,
					insertChildNode,
					insertNodeCount,
				);
				assertChildNodeCount(provider.trees[0], insertNodeCount);

				// edit
				// The editing function iterates over each child node and performs an edit so we have to make sure we have enough children to avoid going out of bounds.
				if (insertNodeCount < editNodeCount) {
					const remainder = editNodeCount - insertNodeCount;
					saveAndResetCurrentOps();
					insertNodesWithIndividualTransactions(
						provider.trees[0],
						provider,
						getJsonNode(childByteSize),
						remainder,
					);
					deleteCurrentOps(); // We don't want to record the ops from re-initializing the tree.
				}
				const editPayload = getEditPayloadInBytes(
					getSuccessfulOpByteSize("EDIT", "INDIVIDUAL", percentile),
				);
				editNodesWithIndividualTransactions(
					provider.trees[0],
					provider,
					editNodeCount,
					editPayload,
				);
				assertChildValuesEqualExpected(provider.trees[0], editPayload, editNodeCount);
			};

			describe("4a.a. [Combination] [Individual Txs] With individual transactions and an equal distribution of operation type", () => {
				const oneThirdNodeCount = Math.floor(BENCHMARK_NODE_COUNT * (1 / 3));

				it(`4a.a.a. [Combination] [Individual Txs] insert ${oneThirdNodeCount} small nodes, delete ${oneThirdNodeCount} small nodes, edit ${oneThirdNodeCount} nodes with small payloads`, () => {
					benchmarkInsertDeleteEditNodesWithInvidiualTxs(
						0.01,
						`4a.a.a. [Combination] [Individual Txs] insert ${oneThirdNodeCount} small nodes, delete ${oneThirdNodeCount} small nodes, edit ${oneThirdNodeCount} nodes with small payloads`,
						oneThirdNodeCount,
						oneThirdNodeCount,
						oneThirdNodeCount,
					);
				});

				it(`4a.a.b. [Combination] [Individual Txs] insert ${oneThirdNodeCount} medium nodes, delete ${oneThirdNodeCount} medium nodes, edit ${oneThirdNodeCount} nodes with medium payloads`, () => {
					benchmarkInsertDeleteEditNodesWithInvidiualTxs(
						0.5,
						`4a.a.b. [Combination] [Individual Txs] insert ${oneThirdNodeCount} medium nodes, delete ${oneThirdNodeCount} medium nodes, edit ${oneThirdNodeCount} nodes with medium payloads`,
						oneThirdNodeCount,
						oneThirdNodeCount,
						oneThirdNodeCount,
					);
				});

				it(`4a.a.c. [Combination] [Individual Txs] insert ${oneThirdNodeCount} large nodes, delete ${oneThirdNodeCount} large medium, edit ${oneThirdNodeCount} nodes with large payloads`, () => {
					benchmarkInsertDeleteEditNodesWithInvidiualTxs(
						1,
						`4a.a.c. [Combination] [Individual Txs] insert ${oneThirdNodeCount} large nodes, delete ${oneThirdNodeCount} large medium, edit ${oneThirdNodeCount} nodes with large payloads`,
						oneThirdNodeCount,
						oneThirdNodeCount,
						oneThirdNodeCount,
					);
				});
			});

			describe("4a.b. [Combination] [Individual Txs] In individual transactions with 70% distribution of operations towards insert", () => {
				const seventyPercentCount = BENCHMARK_NODE_COUNT * 0.7;
				const fifteenPercentCount = BENCHMARK_NODE_COUNT * 0.15;

				it(`4a.b.a. [Combination] [Individual Txs] Insert ${seventyPercentCount} small nodes, delete ${fifteenPercentCount} small nodes, edit ${fifteenPercentCount} nodes with small payloads`, () => {
					benchmarkInsertDeleteEditNodesWithInvidiualTxs(
						0.01,
						`4a.b.a. [Combination] [Individual Txs] Insert ${seventyPercentCount} small nodes, delete ${fifteenPercentCount} small nodes, edit ${fifteenPercentCount} nodes with small payloads`,
						seventyPercentCount,
						fifteenPercentCount,
						fifteenPercentCount,
					);
				});

				it(`4a.b.b. [Combination] [Individual Txs] Insert ${seventyPercentCount} medium nodes, delete ${fifteenPercentCount} medium nodes, edit ${fifteenPercentCount} nodes with medium payloads`, () => {
					benchmarkInsertDeleteEditNodesWithInvidiualTxs(
						0.5,
						`4a.b.b. [Combination] [Individual Txs] Insert ${seventyPercentCount} medium nodes, delete ${fifteenPercentCount} medium nodes, edit ${fifteenPercentCount} nodes with medium payloads`,
						seventyPercentCount,
						fifteenPercentCount,
						fifteenPercentCount,
					);
				});

				it(`4a.b.c. [Combination] [Individual Txs] Insert ${seventyPercentCount} large nodes, delete ${fifteenPercentCount} large nodes, edit ${fifteenPercentCount} nodes with large payloads`, () => {
					benchmarkInsertDeleteEditNodesWithInvidiualTxs(
						1,
						`4a.b.c. [Combination] [Individual Txs] Insert ${seventyPercentCount} large nodes, delete ${fifteenPercentCount} large nodes, edit ${fifteenPercentCount} nodes with large payloads`,
						seventyPercentCount,
						fifteenPercentCount,
						fifteenPercentCount,
					);
				});
			});

			describe("4a.c. [Combination] [Individual Txs] In individual transactions with 70% distribution of operations towards delete", () => {
				const seventyPercentCount = BENCHMARK_NODE_COUNT * 0.7;
				const fifteenPercentCount = BENCHMARK_NODE_COUNT * 0.15;

				it(`4a.c.a. [Combination] [Individual Txs] Insert ${fifteenPercentCount} small nodes, delete ${seventyPercentCount} small nodes, edit ${fifteenPercentCount} nodes with small payloads`, () => {
					benchmarkInsertDeleteEditNodesWithInvidiualTxs(
						0.01,
						`4a.c.a. [Combination] [Individual Txs] Insert ${fifteenPercentCount} small nodes, delete ${seventyPercentCount} small nodes, edit ${fifteenPercentCount} nodes with small payloads`,
						fifteenPercentCount,
						seventyPercentCount,
						fifteenPercentCount,
					);
				});

				it(`4a.c.b. [Combination] [Individual Txs] Insert ${fifteenPercentCount} medium nodes, delete ${seventyPercentCount} medium nodes, edit ${fifteenPercentCount} nodes with medium payloads`, () => {
					benchmarkInsertDeleteEditNodesWithInvidiualTxs(
						0.5,
						`4a.c.b. [Combination] [Individual Txs] Insert ${fifteenPercentCount} medium nodes, delete ${seventyPercentCount} medium nodes, edit ${fifteenPercentCount} nodes with medium payloads`,
						fifteenPercentCount,
						seventyPercentCount,
						fifteenPercentCount,
					);
				});

				it(`4a.c.b. [Combination] [Individual Txs] Insert ${fifteenPercentCount} large nodes, delete ${seventyPercentCount} large nodes, edit ${fifteenPercentCount} nodes with large payloads`, () => {
					benchmarkInsertDeleteEditNodesWithInvidiualTxs(
						1,
						`4a.c.b. [Combination] [Individual Txs] Insert ${fifteenPercentCount} medium nodes, delete ${seventyPercentCount} medium nodes, edit ${fifteenPercentCount} nodes with medium payloads`,
						fifteenPercentCount,
						seventyPercentCount,
						fifteenPercentCount,
					);
				});
			});

			describe("4a.d. [Combination] [Individual Txs] In individual transactions with 70% distribution of operations towards edit", () => {
				const seventyPercentCount = BENCHMARK_NODE_COUNT * 0.7;
				const fifteenPercentCount = BENCHMARK_NODE_COUNT * 0.15;

				it(`4a.d.a. [Combination] [Individual Txs] Insert ${fifteenPercentCount} small nodes, delete ${fifteenPercentCount} small nodes, edit ${seventyPercentCount} nodes with small payloads`, () => {
					benchmarkInsertDeleteEditNodesWithInvidiualTxs(
						0.01,
						`4a.d.a. [Combination] [Individual Txs] Insert ${fifteenPercentCount} small nodes, delete ${fifteenPercentCount} small nodes, edit ${seventyPercentCount} nodes with small payloads`,
						fifteenPercentCount,
						fifteenPercentCount,
						seventyPercentCount,
					);
				});

				it(`4a.d.b. [Combination] [Individual Txs] Insert ${fifteenPercentCount} medium nodes, delete ${fifteenPercentCount} medium nodes, edit ${seventyPercentCount} nodes with medium payloads`, () => {
					benchmarkInsertDeleteEditNodesWithInvidiualTxs(
						0.5,
						`4a.d.b. [Combination] [Individual Txs] Insert ${fifteenPercentCount} medium nodes, delete ${fifteenPercentCount} medium nodes, edit ${seventyPercentCount} nodes with medium payloads`,
						fifteenPercentCount,
						fifteenPercentCount,
						seventyPercentCount,
					);
				});

				it(`4a.d.c. [Combination] [Individual Txs] Insert ${fifteenPercentCount} large nodes, delete ${seventyPercentCount} large nodes, edit ${seventyPercentCount} nodes with large payloads`, () => {
					benchmarkInsertDeleteEditNodesWithInvidiualTxs(
						1,
						`4a.d.c. [Combination] [Individual Txs] Insert ${fifteenPercentCount} large nodes, delete ${seventyPercentCount} large nodes, edit ${seventyPercentCount} nodes with large payloads`,
						fifteenPercentCount,
						fifteenPercentCount,
						seventyPercentCount,
					);
				});
			});
		});

		describe("4b. Insert, Delete & Edit Nodes in Single Transactions", () => {
			const benchmarkInsertDeleteEditNodesWithSingleTxs = (
				percentile: number,
				testName: string,
				insertNodeCount: number,
				deleteNodeCount: number,
				editNodeCount: number,
			) => {
				const provider = new TestTreeProviderLite();
				initializeOpDataCollection(provider, testName);

				// delete
				const childByteSize = getSuccessfulOpByteSize("DELETE", "SINGLE", percentile);
				initializeTestTree(
					provider.trees[0],
					getInitialJsonTreeWithChildren(deleteNodeCount, childByteSize),
				);
				deleteCurrentOps(); // We don't want to record the ops from initializing the tree.
				deleteNodesWithSingleTransaction(provider.trees[0], provider, deleteNodeCount);
				assertChildNodeCount(provider.trees[0], 0);

				// insert
				const insertChildNode = getJsonNode(
					getSuccessfulOpByteSize("INSERT", "SINGLE", percentile),
				);
				insertNodesWithSingleTransaction(
					provider.trees[0],
					provider,
					insertChildNode,
					insertNodeCount,
				);
				assertChildNodeCount(provider.trees[0], insertNodeCount);

				// edit
				// The editing function iterates over each child node and performs an edit so we have to make sure we have enough children to avoid going out of bounds.
				if (insertNodeCount < editNodeCount) {
					const remainder = editNodeCount - insertNodeCount;
					saveAndResetCurrentOps();
					insertNodesWithIndividualTransactions(
						provider.trees[0],
						provider,
						getJsonNode(childByteSize),
						remainder,
					);
					deleteCurrentOps(); // We don't want to record the ops from re-initializing the tree.
				}
				const editPayload = getEditPayloadInBytes(
					getSuccessfulOpByteSize("EDIT", "SINGLE", percentile),
				);
				editNodesWithSingleTransaction(
					provider.trees[0],
					provider,
					editNodeCount,
					editPayload,
				);
				assertChildValuesEqualExpected(provider.trees[0], editPayload, editNodeCount);
			};

			describe("4b.a. [Combination] [Single Tx] With single transactions and an equal distribution of operation type", () => {
				const oneThirdNodeCount = Math.floor(BENCHMARK_NODE_COUNT * (1 / 3));

				it(`4b.a.a. [Combination] [Single Tx] insert ${oneThirdNodeCount} small nodes, delete ${oneThirdNodeCount} small nodes, edit ${oneThirdNodeCount} nodes with small payloads`, () => {
					benchmarkInsertDeleteEditNodesWithSingleTxs(
						0.01,
						`4b.a.a. [Combination] [Single Tx] insert ${oneThirdNodeCount} small nodes, delete ${oneThirdNodeCount} small nodes, edit ${oneThirdNodeCount} nodes with small payloads`,
						oneThirdNodeCount,
						oneThirdNodeCount,
						oneThirdNodeCount,
					);
				});

				it(`4b.a.b. [Combination] [Single Tx] insert ${oneThirdNodeCount} medium nodes, delete ${oneThirdNodeCount} medium nodes, edit ${oneThirdNodeCount} nodes with medium payloads`, () => {
					benchmarkInsertDeleteEditNodesWithSingleTxs(
						0.5,
						`4b.a.b. [Combination] [Single Tx] insert ${oneThirdNodeCount} medium nodes, delete ${oneThirdNodeCount} medium nodes, edit ${oneThirdNodeCount} nodes with medium payloads`,
						oneThirdNodeCount,
						oneThirdNodeCount,
						oneThirdNodeCount,
					);
				});

				it(`4b.a.c. [Combination] [Single Tx] insert ${oneThirdNodeCount} large nodes, delete ${oneThirdNodeCount} large medium, edit ${oneThirdNodeCount} nodes with large payloads`, () => {
					benchmarkInsertDeleteEditNodesWithSingleTxs(
						1,
						`4b.a.c. [Combination] [Single Tx] insert ${oneThirdNodeCount} large nodes, delete ${oneThirdNodeCount} large medium, edit ${oneThirdNodeCount} nodes with large payloads`,
						oneThirdNodeCount,
						oneThirdNodeCount,
						oneThirdNodeCount,
					);
				});
			});

			describe("4b.b. [Combination] [Single Tx] With single transactions with 70% distribution of operations towards insert", () => {
				const seventyPercentCount = BENCHMARK_NODE_COUNT * 0.7;
				const fifteenPercentCount = BENCHMARK_NODE_COUNT * 0.15;

				it(`4b.b.a. [Combination] [Single Tx] Insert ${seventyPercentCount} small nodes, delete ${fifteenPercentCount} small nodes, edit ${fifteenPercentCount} nodes with small payloads`, () => {
					benchmarkInsertDeleteEditNodesWithSingleTxs(
						0.01,
						`4b.b.a. [Combination] [Single Tx] Insert ${seventyPercentCount} small nodes, delete ${fifteenPercentCount} small nodes, edit ${fifteenPercentCount} nodes with small payloads`,
						seventyPercentCount,
						fifteenPercentCount,
						fifteenPercentCount,
					);
				});

				it(`4b.b.b. [Combination] [Single Tx] Insert ${seventyPercentCount} medium nodes, delete ${fifteenPercentCount} medium nodes, edit ${fifteenPercentCount} nodes with medium payloads`, () => {
					benchmarkInsertDeleteEditNodesWithSingleTxs(
						0.5,
						`4b.b.b. [Combination] [Single Tx] Insert ${seventyPercentCount} medium nodes, delete ${fifteenPercentCount} medium nodes, edit ${fifteenPercentCount} nodes with medium payloads`,
						seventyPercentCount,
						fifteenPercentCount,
						fifteenPercentCount,
					);
				});

				it(`4b.b.c. [Combination] [Single Tx] Insert ${seventyPercentCount} large nodes, delete ${fifteenPercentCount} large nodes, edit ${fifteenPercentCount} nodes with large payloads`, () => {
					benchmarkInsertDeleteEditNodesWithSingleTxs(
						1,
						`4b.b.c. [Combination] [Single Tx] Insert ${seventyPercentCount} large nodes, delete ${fifteenPercentCount} large nodes, edit ${fifteenPercentCount} nodes with large payloads`,
						seventyPercentCount,
						fifteenPercentCount,
						fifteenPercentCount,
					);
				});
			});

			describe("4b.c. [Combination] [Single Tx] With single transactions with 70% distribution of operations towards delete", () => {
				const seventyPercentCount = BENCHMARK_NODE_COUNT * 0.7;
				const fifteenPercentCount = BENCHMARK_NODE_COUNT * 0.15;

				it(`4b.c.a. [Combination] [Single Tx] Insert ${fifteenPercentCount} small nodes, delete ${seventyPercentCount} small nodes, edit ${fifteenPercentCount} nodes with small payloads`, () => {
					benchmarkInsertDeleteEditNodesWithSingleTxs(
						0.01,
						`4b.c.a. [Combination] [Single Tx] Insert ${fifteenPercentCount} small nodes, delete ${seventyPercentCount} small nodes, edit ${fifteenPercentCount} nodes with small payloads`,
						fifteenPercentCount,
						seventyPercentCount,
						fifteenPercentCount,
					);
				});

				it(`4b.c.b. [Combination] [Single Tx] Insert ${fifteenPercentCount} medium nodes, delete ${seventyPercentCount} medium nodes, edit ${fifteenPercentCount} nodes with medium payloads`, () => {
					benchmarkInsertDeleteEditNodesWithSingleTxs(
						0.5,
						`4b.c.b. [Combination] [Single Tx] Insert ${fifteenPercentCount} medium nodes, delete ${seventyPercentCount} medium nodes, edit ${fifteenPercentCount} nodes with medium payloads`,
						fifteenPercentCount,
						seventyPercentCount,
						fifteenPercentCount,
					);
				});

				it(`4b.c.b. [Combination] [Single Tx] Insert ${fifteenPercentCount} large nodes, delete ${seventyPercentCount} large nodes, edit ${fifteenPercentCount} nodes with large payloads`, () => {
					benchmarkInsertDeleteEditNodesWithSingleTxs(
						1,
						`4a.c.b. [Combination] [Single Tx] Insert ${fifteenPercentCount} medium nodes, delete ${seventyPercentCount} medium nodes, edit ${fifteenPercentCount} nodes with medium payloads`,
						fifteenPercentCount,
						seventyPercentCount,
						fifteenPercentCount,
					);
				});
			});

			describe("4b.d. [Combination] [Single Tx] In individual With single transactions with 70% distribution of operations towards edit", () => {
				const seventyPercentCount = BENCHMARK_NODE_COUNT * 0.7;
				const fifteenPercentCount = BENCHMARK_NODE_COUNT * 0.15;

				it(`4b.d.a. [Combination] [Single Tx] Insert ${fifteenPercentCount} small nodes, delete ${fifteenPercentCount} small nodes, edit ${seventyPercentCount} nodes with small payloads`, () => {
					benchmarkInsertDeleteEditNodesWithSingleTxs(
						0.01,
						`4a.d.a. [Combination] [Single Tx] Insert ${fifteenPercentCount} small nodes, delete ${fifteenPercentCount} small nodes, edit ${seventyPercentCount} nodes with small payloads`,
						fifteenPercentCount,
						fifteenPercentCount,
						seventyPercentCount,
					);
				});

				it(`4b.d.b. [Combination] [Single Tx] Insert ${fifteenPercentCount} medium nodes, delete ${fifteenPercentCount} medium nodes, edit ${seventyPercentCount} nodes with medium payloads`, () => {
					benchmarkInsertDeleteEditNodesWithSingleTxs(
						0.5,
						`4b.d.b. [Combination] [Single Tx] Insert ${fifteenPercentCount} medium nodes, delete ${fifteenPercentCount} medium nodes, edit ${seventyPercentCount} nodes with medium payloads`,
						fifteenPercentCount,
						fifteenPercentCount,
						seventyPercentCount,
					);
				});

				it(`4b.d.c. [Combination] Single Txs] Insert ${fifteenPercentCount} large nodes, delete ${seventyPercentCount} large nodes, edit ${seventyPercentCount} nodes with large payloads`, () => {
					benchmarkInsertDeleteEditNodesWithSingleTxs(
						1,
						`4b.d.c. [Combination] [Single Tx] Insert ${fifteenPercentCount} large nodes, delete ${seventyPercentCount} large nodes, edit ${seventyPercentCount} nodes with large payloads`,
						fifteenPercentCount,
						fifteenPercentCount,
						seventyPercentCount,
					);
				});
			});
		});
	});
});
