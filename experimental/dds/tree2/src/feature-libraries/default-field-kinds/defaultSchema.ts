/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { fieldSchema, emptyMap, ValueSchema, TreeStoredSchema } from "../../core";
import { FullSchemaPolicy } from "../modular-schema";
import { value, forbidden, fieldKinds } from "./defaultFieldKinds";

/**
 * FieldStoredSchema which is impossible for any data to be in schema with.
 */
export const neverField = fieldSchema(value, []);

/**
 * FieldStoredSchema which is impossible to put anything in.
 * @alpha
 */
export const emptyField = fieldSchema(forbidden, []);

/**
 * TreeStoredSchema which is impossible for any data to be in schema with.
 * @alpha
 */
// TODO: remove need for this.
export const neverTree: TreeStoredSchema = {
	structFields: emptyMap,
	mapFields: neverField,
	value: ValueSchema.Nothing,
};

/**
 * FullSchemaPolicy the default field kinds, empty default fields and neverTree for the default tree schema.
 *
 * This requires new node types to have explicit stored schema to exist in documents,
 * and allows adding new global fields along with their schema at any point.
 * @alpha
 */
export const defaultSchemaPolicy: FullSchemaPolicy = {
	fieldKinds,
};
