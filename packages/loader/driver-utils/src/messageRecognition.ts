/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */
import {
	IDocumentMessage,
	ISequencedDocumentMessage,
	MessageType,
} from "@fluidframework/protocol-definitions";

/**
 * Tells if message was sent by container runtime
 * @privateRemarks ADO #1385: To be moved to container-definitions
 * @returns whether the message is a runtime message
 */
export function isRuntimeMessage(message: { type: string }): boolean {
	return message.type === MessageType.Operation;
}

// ADO #1385: staging code changes across layers.
// Eventually to be replaced by MessageType.accept
export enum MessageType2 {
	Accept = "accept",
}

// ADO #1385: To be moved to packages/protocol-base/src/protocol.ts
export function canBeCoalescedByService(
	message: ISequencedDocumentMessage | IDocumentMessage,
): boolean {
	// This assumes that in the future relay service may implement coalescing of accept messages,
	// same way it was doing coalescing of immediate noops in the past.
	return message.type === MessageType.NoOp || message.type === MessageType2.Accept;
}
