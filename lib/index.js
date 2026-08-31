import z from "@deepseek-ai/schemastery";
import { toolPairingBalancedBefore } from "@deepseek-ai/dsh-compaction";

export const name = "kur-compact-trigger";
export const inject = ["tokenMeter", "settings", "agentPresets"];

const DEFAULT_THRESHOLD_TOKENS = 200000;
const DEFAULT_RETAIN_TOKENS = 32000;
const MAX_ATTEMPTS = 3;

/**
 * 会话级自动压缩触发器（host 平面版）。
 *
 * 挂在 HOST 平面，所有 preset 的会话共享。compaction 在 preset realm 内，
 * 本插件不 inject compaction，而是在 agent/pre-step 里通过
 * ctx.agentPresets.serviceFor(agent, 'compaction') 解析。
 *
 * 配置：settings.yaml 的 `kur-compact-trigger:` 段；桌面端设置页 + 会话标题栏可改。
 * schemastery 的 object 字段默认可选，会话覆盖只需写要改的键即可。
 */
const SessionOverrideSchema = z.object({
	thresholdTokens: z.number(),
	retainTokens: z.number(),
	maxAttempts: z.number(),
});

const SettingsSchema = z.object({
	thresholdTokens: z.number().default(DEFAULT_THRESHOLD_TOKENS),
	retainTokens: z.number().default(DEFAULT_RETAIN_TOKENS),
	maxAttempts: z.number().default(MAX_ATTEMPTS),
	sessions: z.dict(SessionOverrideSchema).default({}),
});

const SETTINGS_NS = "kur-compact-trigger";

export function apply(ctx, config = {}) {
	const settings = ctx.settings.register(SETTINGS_NS, SettingsSchema, {
		base: {
			thresholdTokens: config.thresholdTokens ?? DEFAULT_THRESHOLD_TOKENS,
			retainTokens: config.retainTokens ?? DEFAULT_RETAIN_TOKENS,
			maxAttempts: config.maxAttempts ?? MAX_ATTEMPTS,
			sessions: {},
		},
	});

	function resolvePolicy(sessionId) {
		const value = settings.get();
		const override = value?.sessions?.[sessionId];
		return {
			thresholdTokens: override?.thresholdTokens ?? value?.thresholdTokens ?? config.thresholdTokens ?? DEFAULT_THRESHOLD_TOKENS,
			retainTokens: override?.retainTokens ?? value?.retainTokens ?? config.retainTokens ?? DEFAULT_RETAIN_TOKENS,
			maxAttempts: override?.maxAttempts ?? value?.maxAttempts ?? config.maxAttempts ?? MAX_ATTEMPTS,
		};
	}

	ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
		try {
			if (signal?.aborted) return next();
			const session = agent.session;
			const policy = resolvePolicy(session.id);
			let measurement = ctx.tokenMeter.measure(session);
			let attempts = 0;
			while (measurement.totalTokens >= policy.thresholdTokens && attempts < policy.maxAttempts) {
				attempts += 1;
				const compaction = ctx.agentPresets.serviceFor(agent, "compaction");
				if (compaction === void 0) {
					ctx.logger.debug(`kur-compact-trigger [${session.id.slice(0, 12)}]: no compaction service in agent preset; skipping`);
					break;
				}
				const range = selectCompactableRange(session, measurement, policy.retainTokens);
				if (range === null) break;
				ctx.logger.info(
					`kur-compact-trigger [${session.id.slice(0, 12)}]: ${measurement.totalTokens} tokens >= ${policy.thresholdTokens}; compacting seqs ${range.start}-${range.end}`,
				);
				const result = await compaction.compactRegion(range.start, range.end, agent, signal);
				ctx.logger.info(
					`kur-compact-trigger [${session.id.slice(0, 12)}]: compacted ${result.shadowedSeqs.length} surface nodes (~${result.shadowedTokenCount} tokens)`,
				);
				measurement = ctx.tokenMeter.measure(session);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.logger.warn(`kur-compact-trigger: compaction failed: ${message}; continuing the turn`);
		}
		return next();
	});
}

function selectCompactableRange(session, measurement, retainTokens) {
	const pricedNodes = measurement.nodes;
	if (pricedNodes.length === 0) return null;
	const surfaceNodes = session.surface.nodes;
	if (surfaceNodes.length !== pricedNodes.length || surfaceNodes.some((seq, index) => seq !== pricedNodes[index]?.seq)) {
		throw new Error("kur-compact-trigger: token-meter surface does not match the current session surface");
	}
	let accumulated = 0;
	let keepFromIdx = pricedNodes.length;
	for (let index = pricedNodes.length - 1; index >= 0; index -= 1) {
		accumulated += pricedNodes[index].tokens;
		keepFromIdx = index;
		if (accumulated >= retainTokens) break;
	}
	if (keepFromIdx === 0) return null;
	while (keepFromIdx > 0) {
		if (toolPairingBalancedBefore(session, surfaceNodes[keepFromIdx])) break;
		keepFromIdx -= 1;
	}
	if (keepFromIdx === 0) return null;
	return {
		start: surfaceNodes[0],
		end: surfaceNodes[keepFromIdx - 1],
	};
}
