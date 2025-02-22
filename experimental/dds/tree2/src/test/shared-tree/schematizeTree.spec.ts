/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */
import { strict as assert } from "assert";
import { MockFluidDataStoreRuntime } from "@fluidframework/test-runtime-utils";
import { SchemaBuilder, Any } from "../../feature-libraries";
import { SharedTreeFactory } from "../../shared-tree";
import { ValueSchema, AllowedUpdateType, storedEmptyFieldSchema } from "../../core";
import { typeboxValidator } from "../../external-utilities";

const factory = new SharedTreeFactory({ jsonValidator: typeboxValidator });
const builder = new SchemaBuilder("Schematize Tree Tests");

const root = builder.leaf("root", ValueSchema.Number);
const schema = builder.intoDocumentSchema(SchemaBuilder.fieldOptional(Any));

const builderGeneralized = new SchemaBuilder("Schematize Tree Tests Generalized");
const rootGeneralized = builderGeneralized.leaf("root", ValueSchema.Serializable);
const schemaGeneralized = builderGeneralized.intoDocumentSchema(SchemaBuilder.fieldOptional(Any));

describe("schematizeView", () => {
	it("initialize tree schema", () => {
		const tree = factory.create(new MockFluidDataStoreRuntime(), "test");

		assert.equal(tree.storedSchema.rootFieldSchema, storedEmptyFieldSchema);

		const schematized = tree.schematize({
			allowedSchemaModifications: AllowedUpdateType.None,
			initialTree: 10,
			schema,
		});

		assert.deepEqual(
			schematized.storedSchema.rootFieldSchema,
			schemaGeneralized.rootFieldSchema,
		);
		assert(schematized.storedSchema.treeSchema.has(root.name));
		assert.equal(schematized.root, 10);
	});

	it("noop upgrade", () => {
		const tree = factory.create(new MockFluidDataStoreRuntime(), "test");
		tree.storedSchema.update(schema);

		// No op upgrade with AllowedUpdateType.None does not error
		const schematized = tree.schematize({
			allowedSchemaModifications: AllowedUpdateType.None,
			initialTree: 10,
			schema,
		});
		// And does not add initial tree:
		assert.equal(schematized.root, undefined);
	});

	it("upgrade schema errors when in AllowedUpdateType.None", () => {
		const tree = factory.create(new MockFluidDataStoreRuntime(), "test");
		tree.storedSchema.update(schema);
		assert.throws(() => {
			tree.schematize({
				allowedSchemaModifications: AllowedUpdateType.None,
				initialTree: "x",
				schema: schemaGeneralized,
			});
		});
	});

	it("incompatible upgrade errors", () => {
		const tree = factory.create(new MockFluidDataStoreRuntime(), "test");
		tree.storedSchema.update(schemaGeneralized);
		assert.throws(() => {
			tree.schematize({
				allowedSchemaModifications: AllowedUpdateType.None,
				initialTree: "x",
				schema,
			});
		});
	});

	it("upgrade schema", () => {
		const tree = factory.create(new MockFluidDataStoreRuntime(), "test");
		tree.storedSchema.update(schema);
		const schematized = tree.schematize({
			allowedSchemaModifications: AllowedUpdateType.SchemaCompatible,
			initialTree: "x",
			schema: schemaGeneralized,
		});
		// Initial tree should not be applied
		assert.equal(schematized.root, undefined);
	});
});
