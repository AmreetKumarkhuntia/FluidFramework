/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { ITelemetryLoggerExt, TelemetryDataTag } from "@fluidframework/telemetry-utils";
import { ISnapshotTree, ISummaryTree, SummaryObject } from "@fluidframework/protocol-definitions";
import { channelsTreeName, ISummaryTreeWithStats } from "@fluidframework/runtime-definitions";
import { ReadAndParseBlob } from "@fluidframework/runtime-utils";

/**
 * Return type of refreshSummaryAck function. There can be three different scenarios based on the passed params:
 *
 * 1. The latest summary was not updated.
 *
 * 2. The latest summary was updated and the summary corresponding to the params was tracked by this client.
 *
 * 3. The latest summary was updated but the summary corresponding to the params was not tracked. In this case, the
 * latest snapshot is fetched and the latest summary state is updated based on it.
 */
export type RefreshSummaryResult =
	| {
			latestSummaryUpdated: false;
	  }
	| {
			latestSummaryUpdated: true;
			wasSummaryTracked: true;
			summaryRefSeq: number;
	  }
	| {
			latestSummaryUpdated: true;
			wasSummaryTracked: false;
			snapshotTree: ISnapshotTree;
			summaryRefSeq: number;
	  };

/**
 * Result of snapshot fetch during refreshing latest summary state.
 */
export interface IFetchSnapshotResult {
	snapshotTree: ISnapshotTree;
	snapshotRefSeq: number;
}

/**
 * Return type of validateSummary function. In case of success, the object returned should have success: true.
 * In case of failure, the object returned should have success: false and additional properties to indicate what
 * the failure was, where it was, can it be retried, etc.
 */
export type ValidateSummaryResult =
	| {
			success: true;
	  }
	| {
			success: false;
			/** The failure reason */
			reason: string;
			/** id of the node that failed during validation */
			id: {
				tag: TelemetryDataTag.CodeArtifact;
				value: string | undefined;
			};
			/** If the error can be retried, time to wait before retrying */
			retryAfterSeconds?: number;
	  };

export interface ISummarizerNodeRootContract {
	startSummary(referenceSequenceNumber: number, summaryLogger: ITelemetryLoggerExt): void;
	validateSummary(): ValidateSummaryResult;
	completeSummary(proposalHandle: string, validate: boolean): void;
	clearSummary(): void;
	refreshLatestSummary(
		proposalHandle: string | undefined,
		summaryRefSeq: number,
		fetchLatestSnapshot: () => Promise<IFetchSnapshotResult>,
		readAndParseBlob: ReadAndParseBlob,
		correlatedSummaryLogger: ITelemetryLoggerExt,
	): Promise<RefreshSummaryResult>;
}

/** Path for nodes in a tree with escaped special characters */
export class EscapedPath {
	private constructor(public readonly path: string) {}
	public static create(path: string): EscapedPath {
		return new EscapedPath(encodeURIComponent(path));
	}
	public static createAndConcat(pathParts: string[]): EscapedPath {
		let ret = EscapedPath.create(pathParts[0] ?? "");
		for (let i = 1; i < pathParts.length; i++) {
			ret = ret.concat(EscapedPath.create(pathParts[i]));
		}
		return ret;
	}
	public toString(): string {
		return this.path;
	}
	public concat(path: EscapedPath): EscapedPath {
		return new EscapedPath(`${this.path}/${path.path}`);
	}
}

/** Information about a summary relevant to a specific node in the tree */
export class SummaryNode {
	/** Creates an instance that is valid for the root with specific basePath and localPath */
	public static createForRoot(referenceSequenceNumber: number): SummaryNode {
		return new SummaryNode({
			referenceSequenceNumber,
			basePath: undefined,
			localPath: EscapedPath.create(""), // root hard-coded to ""
		});
	}

	/** Summary reference sequence number, i.e. last sequence number seen when it was created */
	public get referenceSequenceNumber(): number {
		return this.summary.referenceSequenceNumber;
	}
	/** Full path to parent node, or undefined if this is the root */
	public get basePath(): EscapedPath | undefined {
		return this.summary.basePath;
	}
	/** Relative path to this node from its parent node */
	public get localPath(): EscapedPath {
		return this.summary.localPath;
	}
	/** Relative path from this node to its node innermost base summary */
	public get additionalPath(): EscapedPath | undefined {
		return this.summary.additionalPath;
	}
	public set additionalPath(additionalPath: EscapedPath | undefined) {
		this.summary.additionalPath = additionalPath;
	}
	constructor(
		private readonly summary: {
			readonly referenceSequenceNumber: number;
			readonly basePath: EscapedPath | undefined;
			readonly localPath: EscapedPath;
			additionalPath?: EscapedPath;
		},
	) {}

	/** Gets the full path to this node, to be used when sending a handle */
	public get fullPath(): EscapedPath {
		return this.basePath?.concat(this.localPath) ?? this.localPath;
	}

	/**
	 * Gets the full path to this node's innermost base summary.
	 * The children nodes can use this as their basePath to determine their path.
	 */
	public get fullPathForChildren(): EscapedPath {
		return this.additionalPath !== undefined
			? this.fullPath.concat(this.additionalPath)
			: this.fullPath;
	}

	/**
	 * Creates a new node within the same summary for a child of this node.
	 * @param id - id of the child node
	 */
	public createForChild(id: string): SummaryNode {
		return new SummaryNode({
			referenceSequenceNumber: this.referenceSequenceNumber,
			basePath: this.fullPathForChildren,
			localPath: EscapedPath.create(id),
		});
	}
}

/**
 * Information about the initial summary tree found from an attach op.
 */
export interface IInitialSummary {
	sequenceNumber: number;
	id: string;
	summary: ISummaryTreeWithStats | undefined;
}

/**
 * Represents the details needed to create a child summarizer node.
 */
export interface ICreateChildDetails {
	/** Summary from attach op if known */
	initialSummary: IInitialSummary | undefined;
	/** Latest summary from server node data */
	latestSummary: SummaryNode | undefined;
	/** Sequence number of latest known change to the node */
	changeSequenceNumber: number;
	/** A unique id of this child to be logged when sending telemetry. */
	telemetryNodeId: string;
}

export interface ISubtreeInfo<T extends ISnapshotTree | SummaryObject> {
	/** Tree to use to find children subtrees */
	childrenTree: T;
	/** Additional path part where children are isolated */
	childrenPathPart: string | undefined;
}

/**
 * Checks if the summary contains .channels subtree where the children subtrees
 * would be located if exists.
 * @param baseSummary - summary to check
 */
export function parseSummaryForSubtrees(baseSummary: ISnapshotTree): ISubtreeInfo<ISnapshotTree> {
	// New versions of snapshots have child nodes isolated in .channels subtree
	const channelsSubtree = baseSummary.trees[channelsTreeName];
	if (channelsSubtree !== undefined) {
		return {
			childrenTree: channelsSubtree,
			childrenPathPart: channelsTreeName,
		};
	}
	return {
		childrenTree: baseSummary,
		childrenPathPart: undefined,
	};
}

/**
 * Checks if the summary contains .channels subtree where the children subtrees
 * would be located if exists.
 * @param baseSummary - summary to check
 */
export function parseSummaryTreeForSubtrees(summary: ISummaryTree): ISubtreeInfo<SummaryObject> {
	// New versions of snapshots have child nodes isolated in .channels subtree
	const channelsSubtree = summary.tree[channelsTreeName];
	if (channelsSubtree !== undefined) {
		return {
			childrenTree: channelsSubtree,
			childrenPathPart: channelsTreeName,
		};
	}
	return {
		childrenTree: summary,
		childrenPathPart: undefined,
	};
}
