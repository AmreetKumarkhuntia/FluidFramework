/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

// Allow importing from this specific file which is being tested:
/* eslint-disable-next-line import/no-internal-modules */
import { buildForest } from "../../feature-libraries/object-forest";

import { testForest } from "../forestTestSuite";

testForest({
	suiteName: "object-forest",
	factory: (schema) => buildForest(schema),
});
