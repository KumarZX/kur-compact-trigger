window.__ModuleLoader__.load({
	id: "kur-compact-trigger",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const { jsx, jsxs, Fragment } = require("react/jsx-runtime");
		const react = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const NS = "kur-compact-trigger";
		const SETTINGS_NS = "kur-compact-trigger";
		const DEFAULT_THRESHOLD = 200000;
		const DEFAULT_RETAIN = 32000;
		const DEFAULT_MAX_ATTEMPTS = 3;
		/** 滑条保底上限（模型窗口未知时）；已知 contextWindow 时以其为准 */
		const FALLBACK_CONTEXT_MAX = 1048576;
		const MIN_THRESHOLD = 10000;

		const zh = {
			nav: "自动压缩",
			"settings.title": "自动压缩触发",
			"settings.desc": "每轮对话开始前检查上下文长度；超阈值时自动压缩旧消息。可在此改全局默认，也可在会话标题栏单独覆盖。",
			"field.threshold": "压缩阈值（tokens）",
			"field.threshold.desc": "上下文总 token 达到此值时触发压缩。可用滑条调整；上限跟随当前模型上下文窗口。",
			"field.threshold.cap": "模型上限",
			"field.threshold.capUnknown": "模型窗口未知，暂用通用上限",
			"field.retain": "保留尾部（tokens）",
			"field.retain.desc": "压缩时尽量保留尾部最近约这么多 token。默认 32000。",
			"field.maxAttempts": "单轮最大压缩次数",
			"field.maxAttempts.desc": "一次 turn 内最多压缩几次。默认 3。",
			save: "保存",
			saving: "保存中…",
			saved: "已保存并生效",
			"save.failed": "保存失败",
			"save.verifyFailed": "写入未生效（回显与提交值不一致）",
			"session.action": "压缩阈值",
			"session.action.aria": "设置本会话压缩阈值",
			"session.title": "本会话压缩阈值",
			"session.desc": "只影响当前会话。留空表示跟随全局设置。",
			"session.effective": "当前生效",
			"session.clear": "清除覆盖（跟随全局）",
			"session.cleared": "已清除，跟随全局",
			"session.global": "全局",
			"placeholder.follow": "跟随全局",
			"status.loading": "正在加载配置…",
			"status.unavailable": "配置不可用（命名空间未暴露或解码失败）",
			"status.readonly": "当前为只读，无法写入",
			echo: "回显",
		};

		const en = {
			nav: "Compact",
			"settings.title": "Auto Compact Trigger",
			"settings.desc": "Before each turn, compact old messages when over the threshold. Set a global default here, or override per session from the chat header.",
			"field.threshold": "Threshold (tokens)",
			"field.threshold.desc": "Trigger when total context tokens reach this value. Drag the slider; max follows the model context window.",
			"field.threshold.cap": "Model max",
			"field.threshold.capUnknown": "Model window unknown — using a generic max",
			"field.retain": "Retain tail (tokens)",
			"field.retain.desc": "Keep roughly this many recent tokens. Default 32000.",
			"field.maxAttempts": "Max attempts per turn",
			"field.maxAttempts.desc": "Cap compaction loops in one turn. Default 3.",
			save: "Save",
			saving: "Saving…",
			saved: "Saved",
			"save.failed": "Save failed",
			"save.verifyFailed": "Write did not stick (echo mismatch)",
			"session.action": "Compact",
			"session.action.aria": "Set compact threshold for this session",
			"session.title": "Session compact threshold",
			"session.desc": "Applies to this session only. Leave blank to follow global settings.",
			"session.effective": "Effective now",
			"session.clear": "Clear override (follow global)",
			"session.cleared": "Cleared — following global",
			"session.global": "Global",
			"placeholder.follow": "Follow global",
			"status.loading": "Loading settings…",
			"status.unavailable": "Settings unavailable (namespace not exposed or decode failed)",
			"status.readonly": "Read-only; cannot write",
			echo: "Echo",
		};

		function decodeValue(raw) {
			if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return void 0;
			const sessionsRaw = raw.sessions;
			const sessions = {};
			if (typeof sessionsRaw === "object" && sessionsRaw !== null && !Array.isArray(sessionsRaw)) {
				for (const [id, entry] of Object.entries(sessionsRaw)) {
					if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
					const next = {};
					if (Number.isFinite(Number(entry.thresholdTokens))) next.thresholdTokens = Number(entry.thresholdTokens);
					if (Number.isFinite(Number(entry.retainTokens))) next.retainTokens = Number(entry.retainTokens);
					if (Number.isFinite(Number(entry.maxAttempts))) next.maxAttempts = Number(entry.maxAttempts);
					if (Object.keys(next).length > 0) sessions[id] = next;
				}
			}
			return {
				thresholdTokens: Number.isFinite(Number(raw.thresholdTokens)) ? Number(raw.thresholdTokens) : DEFAULT_THRESHOLD,
				retainTokens: Number.isFinite(Number(raw.retainTokens)) ? Number(raw.retainTokens) : DEFAULT_RETAIN,
				maxAttempts: Number.isFinite(Number(raw.maxAttempts)) ? Number(raw.maxAttempts) : DEFAULT_MAX_ATTEMPTS,
				sessions,
			};
		}

		function useScopeSnapshot(scope) {
			return react.useSyncExternalStore(
				(listener) => scope.subscribe(listener),
				() => scope.getSnapshot(),
				() => scope.getSnapshot(),
			);
		}

		function errMessage(error) {
			return error instanceof Error ? error.message : String(error);
		}

		/**
		 * Direct mutate with result check. SettingsScopeController.set() swallows failures.
		 */
		async function mutateOps(api, scope, ops) {
			const revision = scope.getSnapshot().revision;
			const response = await api.settings.mutate({
				ns: SETTINGS_NS,
				ops,
				...(revision === void 0 ? {} : { expectedRevision: revision }),
			});
			if (!response?.result?.ok) {
				const failure = response?.result;
				throw new Error(failure?.error?.message ?? failure?.message ?? "settings.mutate rejected");
			}
			// SettingsScope has getSnapshot/subscribe/set/unset only — no load().
			// Host loopback emits settings/document-updated and the mirror derives.
			const answeredRevision = response?.result?.value?.revision;
			for (let i = 0; i < 20; i += 1) {
				const snap = scope.getSnapshot();
				if (answeredRevision == null || snap?.revision === answeredRevision) return snap;
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			return scope.getSnapshot();
		}

		const fieldBox = {
			display: "flex",
			flexDirection: "column",
			gap: 4,
		};
		const inputStyle = {
			padding: "6px 10px",
			borderRadius: 8,
			border: "1px solid var(--dsw-alias-border-l2, #ccc)",
			fontSize: 13,
			background: "var(--dsw-alias-bg-layer-3, transparent)",
			color: "var(--dsw-alias-label-primary, inherit)",
		};
		const hintStyle = {
			margin: 0,
			opacity: 0.65,
			fontSize: 12,
			lineHeight: 1.5,
		};

		function formatTokens(n) {
			const v = Number(n);
			if (!Number.isFinite(v) || v <= 0) return "—";
			if (v >= 1000000) return `${(v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1)}M`;
			if (v >= 1000) return `${Math.round(v / 1000)}k`;
			return String(Math.round(v));
		}

		function clampThreshold(raw, max) {
			const n = Number(raw);
			if (!Number.isFinite(n)) return MIN_THRESHOLD;
			const hi = Number.isFinite(max) && max > 0 ? max : FALLBACK_CONTEXT_MAX;
			return Math.min(hi, Math.max(MIN_THRESHOLD, Math.round(n)));
		}

		/** 从已激活 provider 的模型目录探测最大 contextWindow */
		async function probeModelContextMax(api) {
			if (!api?.llm?.providers || !api?.llm?.discoverModels) return null;
			try {
				const listed = await api.llm.providers({});
				const providers = listed?.providers || [];
				let max = 0;
				for (const p of providers) {
					if (!p?.active || !p.settingsNs) continue;
					try {
						const disc = await api.llm.discoverModels({
							settingsNs: p.settingsNs,
							provider: p.provider,
						});
						for (const m of disc?.models || []) {
							const cw = Number(m?.contextWindow);
							if (Number.isFinite(cw) && cw > max) max = cw;
						}
					} catch {}
				}
				return max > 0 ? max : null;
			} catch {
				return null;
			}
		}

		function useContextCap({ api, useProjection, preferSession }) {
			const pressure =
				preferSession && typeof useProjection === "function" ? useProjection("contextPressure") : null;
			const sessionCap = Number(pressure?.contextWindow);
			const [catalogCap, setCatalogCap] = react.useState(null);

			react.useEffect(() => {
				let alive = true;
				(async () => {
					const max = await probeModelContextMax(api);
					if (alive) setCatalogCap(max);
				})();
				return () => {
					alive = false;
				};
			}, [api]);

			const known =
				Number.isFinite(sessionCap) && sessionCap > 0
					? sessionCap
					: Number.isFinite(catalogCap) && catalogCap > 0
						? catalogCap
						: null;
			const max = known ?? FALLBACK_CONTEXT_MAX;
			return { max, known: known != null, sessionCap: Number.isFinite(sessionCap) && sessionCap > 0 ? sessionCap : null };
		}

		function TokenSliderField({
			label,
			desc,
			value,
			onChange,
			disabled,
			max,
			known,
			t,
			allowEmpty = false,
			placeholder,
		}) {
			const numeric = Number(value);
			const hasValue = String(value ?? "").trim() !== "" && Number.isFinite(numeric);
			const sliderValue = hasValue ? clampThreshold(numeric, max) : Math.min(DEFAULT_THRESHOLD, max);
			const capText = known
				? `${t("field.threshold.cap")}: ${formatTokens(max)} (${max})`
				: `${t("field.threshold.capUnknown")}: ${formatTokens(max)}`;

			return jsxs("label", {
				style: fieldBox,
				children: [
					jsx("span", { style: { fontWeight: 500, fontSize: 13 }, children: label }),
					jsx("span", { style: hintStyle, children: desc }),
					jsx("span", { style: { ...hintStyle, opacity: 0.85 }, children: capText }),
					jsx("input", {
						type: "range",
						min: MIN_THRESHOLD,
						max: Math.max(MIN_THRESHOLD, max),
						step: 1000,
						value: sliderValue,
						disabled,
						onChange: (e) => onChange(String(clampThreshold(e.target.value, max))),
						style: { width: "100%", accentColor: "var(--dsw-alias-state-brand-primary, #3b82f6)" },
					}),
					jsxs("div", {
						style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
						children: [
							jsx("span", { style: hintStyle, children: formatTokens(MIN_THRESHOLD) }),
							jsx("input", {
								type: "number",
								min: MIN_THRESHOLD,
								max: Math.max(MIN_THRESHOLD, max),
								step: 1000,
								placeholder,
								value: value,
								disabled,
								onChange: (e) => {
									const raw = e.target.value;
									if (allowEmpty && String(raw).trim() === "") {
										onChange("");
										return;
									}
									onChange(String(clampThreshold(raw, max)));
								},
								style: { ...inputStyle, flex: 1 },
							}),
							jsx("span", { style: hintStyle, children: formatTokens(max) }),
						],
					}),
				],
			});
		}

		function CompactTriggerSection({ scope, api, t, useProjection }) {
			const snap = useScopeSnapshot(scope);
			const value = snap?.value;
			const { max: contextMax, known: capKnown } = useContextCap({ api, useProjection, preferSession: true });
			const [threshold, setThreshold] = react.useState("");
			const [retain, setRetain] = react.useState("");
			const [maxAttempts, setMaxAttempts] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [status, setStatus] = react.useState({ kind: "", text: "" });

			react.useEffect(() => {
				if (!value) {
					setThreshold("");
					setRetain("");
					setMaxAttempts("");
					return;
				}
				setThreshold(String(clampThreshold(value.thresholdTokens ?? DEFAULT_THRESHOLD, contextMax)));
				setRetain(String(value.retainTokens ?? ""));
				setMaxAttempts(String(value.maxAttempts ?? ""));
			}, [value?.thresholdTokens, value?.retainTokens, value?.maxAttempts, snap?.revision, contextMax]);

			async function save() {
				const nextThreshold = clampThreshold(threshold, contextMax);
				const nextRetain = Number(retain);
				const nextMax = Number(maxAttempts);
				if (!Number.isFinite(nextThreshold) || nextThreshold <= 0) {
					setStatus({ kind: "err", text: `${t("save.failed")}: threshold` });
					return;
				}
				if (!Number.isFinite(nextRetain) || nextRetain <= 0) {
					setStatus({ kind: "err", text: `${t("save.failed")}: retain` });
					return;
				}
				if (!Number.isFinite(nextMax) || nextMax <= 0) {
					setStatus({ kind: "err", text: `${t("save.failed")}: maxAttempts` });
					return;
				}
				if (snap?.writable === false) {
					setStatus({ kind: "err", text: t("status.readonly") });
					return;
				}

				setBusy(true);
				setStatus({ kind: "", text: "" });
				try {
					const after = await mutateOps(api, scope, [
						{ op: "set", path: ["thresholdTokens"], value: nextThreshold },
						{ op: "set", path: ["retainTokens"], value: nextRetain },
						{ op: "set", path: ["maxAttempts"], value: nextMax },
					]);
					const echoed = after?.value;
					if (
						echoed?.thresholdTokens !== nextThreshold ||
						echoed?.retainTokens !== nextRetain ||
						echoed?.maxAttempts !== nextMax
					) {
						throw new Error("echo mismatch");
					}
					setThreshold(String(echoed.thresholdTokens));
					setRetain(String(echoed.retainTokens));
					setMaxAttempts(String(echoed.maxAttempts));
					setStatus({ kind: "ok", text: t("saved") });
				} catch (error) {
					const message = errMessage(error);
					setStatus({
						kind: "err",
						text: message.includes("echo mismatch") ? t("save.verifyFailed") : `${t("save.failed")}: ${message}`,
					});
				} finally {
					setBusy(false);
				}
			}

			if (snap?.status === "loading" || snap?.status === "idle") {
				return jsx("p", { style: hintStyle, children: t("status.loading") });
			}
			if (snap?.status === "unavailable" || value === void 0) {
				return jsx("p", {
					style: { ...hintStyle, color: "var(--dsw-alias-label-error, #c44)" },
					children: t("status.unavailable"),
				});
			}

			return jsxs("div", {
				style: { display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 },
				children: [
					jsx("p", { style: hintStyle, children: t("settings.desc") }),
					jsx(TokenSliderField, {
						label: t("field.threshold"),
						desc: t("field.threshold.desc"),
						value: threshold,
						onChange: setThreshold,
						disabled: busy || snap.writable === false,
						max: contextMax,
						known: capKnown,
						t,
					}),
					jsxs("label", {
						style: fieldBox,
						children: [
							jsx("span", { style: { fontWeight: 500, fontSize: 13 }, children: t("field.retain") }),
							jsx("span", { style: hintStyle, children: t("field.retain.desc") }),
							jsx("input", {
								type: "number",
								value: retain,
								disabled: busy || snap.writable === false,
								onChange: (e) => setRetain(e.target.value),
								style: inputStyle,
							}),
						],
					}),
					jsxs("label", {
						style: fieldBox,
						children: [
							jsx("span", { style: { fontWeight: 500, fontSize: 13 }, children: t("field.maxAttempts") }),
							jsx("span", { style: hintStyle, children: t("field.maxAttempts.desc") }),
							jsx("input", {
								type: "number",
								value: maxAttempts,
								disabled: busy || snap.writable === false,
								onChange: (e) => setMaxAttempts(e.target.value),
								style: inputStyle,
							}),
						],
					}),
					jsxs("div", {
						style: { display: "flex", alignItems: "center", gap: 12 },
						children: [
							jsx(primitives.Button, {
								variant: "outline",
								size: "sm",
								disabled: busy || snap.writable === false,
								onClick: save,
								children: busy ? t("saving") : t("save"),
							}),
							status.text
								? jsx("span", {
										style: {
											fontSize: 12,
											color:
												status.kind === "ok"
													? "var(--dsw-alias-state-success-primary, #2a7)"
													: "var(--dsw-alias-label-error, #c44)",
										},
										children: status.text,
									})
								: null,
						],
					}),
					jsx("p", {
						style: hintStyle,
						children: `${t("echo")}: ${value.thresholdTokens} · ${value.retainTokens} · ${value.maxAttempts}`,
					}),
				],
			});
		}

		function SessionCompactAction({ sessionId, scope, api, t, useProjection }) {
			const snap = useScopeSnapshot(scope);
			const value = snap?.value;
			const override = value?.sessions?.[sessionId];
			const effectiveThreshold = override?.thresholdTokens ?? value?.thresholdTokens;
			const hasOverride = Boolean(
				override &&
					(override.thresholdTokens !== void 0 ||
						override.retainTokens !== void 0 ||
						override.maxAttempts !== void 0),
			);
			const { max: contextMax, known: capKnown } = useContextCap({ api, useProjection, preferSession: true });

			const [open, setOpen] = react.useState(false);
			const [threshold, setThreshold] = react.useState("");
			const [retain, setRetain] = react.useState("");
			const [maxAttempts, setMaxAttempts] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [status, setStatus] = react.useState({ kind: "", text: "" });

			react.useEffect(() => {
				if (!open) return;
				setThreshold(override?.thresholdTokens != null ? String(clampThreshold(override.thresholdTokens, contextMax)) : "");
				setRetain(override?.retainTokens != null ? String(override.retainTokens) : "");
				setMaxAttempts(override?.maxAttempts != null ? String(override.maxAttempts) : "");
				setStatus({ kind: "", text: "" });
			}, [open, sessionId, override?.thresholdTokens, override?.retainTokens, override?.maxAttempts, contextMax]);

			async function save() {
				if (!sessionId) {
					setStatus({ kind: "err", text: t("save.failed") });
					return;
				}
				if (snap?.writable === false) {
					setStatus({ kind: "err", text: t("status.readonly") });
					return;
				}

				const ops = [];
				const expect = { ...(override ?? {}) };

				const parseOptional = (raw, key) => {
					const trimmed = String(raw).trim();
					if (trimmed === "") {
						if (expect[key] !== void 0) {
							ops.push({ op: "unset", path: ["sessions", sessionId, key] });
							delete expect[key];
						}
						return;
					}
					let n = Number(trimmed);
					if (!Number.isFinite(n) || n <= 0) throw new Error(key);
					if (key === "thresholdTokens") n = clampThreshold(n, contextMax);
					ops.push({ op: "set", path: ["sessions", sessionId, key], value: n });
					expect[key] = n;
				};

				setBusy(true);
				setStatus({ kind: "", text: "" });
				try {
					parseOptional(threshold, "thresholdTokens");
					parseOptional(retain, "retainTokens");
					parseOptional(maxAttempts, "maxAttempts");

					const keysLeft = Object.keys(expect);
					if (keysLeft.length === 0) {
						await mutateOps(api, scope, [{ op: "unset", path: ["sessions", sessionId] }]);
					} else if (ops.length > 0) {
						await mutateOps(api, scope, ops);
					}

					const after = scope.getSnapshot()?.value?.sessions?.[sessionId];
					for (const key of ["thresholdTokens", "retainTokens", "maxAttempts"]) {
						if ((after?.[key] ?? void 0) !== (expect[key] ?? void 0)) {
							throw new Error("echo mismatch");
						}
					}
					setStatus({ kind: "ok", text: keysLeft.length === 0 ? t("session.cleared") : t("saved") });
				} catch (error) {
					const message = errMessage(error);
					setStatus({
						kind: "err",
						text: message.includes("echo mismatch") ? t("save.verifyFailed") : `${t("save.failed")}: ${message}`,
					});
				} finally {
					setBusy(false);
				}
			}

			async function clearOverride() {
				if (!sessionId || snap?.writable === false) return;
				setBusy(true);
				setStatus({ kind: "", text: "" });
				try {
					await mutateOps(api, scope, [{ op: "unset", path: ["sessions", sessionId] }]);
					if (scope.getSnapshot()?.value?.sessions?.[sessionId]) throw new Error("echo mismatch");
					setThreshold("");
					setRetain("");
					setMaxAttempts("");
					setStatus({ kind: "ok", text: t("session.cleared") });
				} catch (error) {
					setStatus({ kind: "err", text: `${t("save.failed")}: ${errMessage(error)}` });
				} finally {
					setBusy(false);
				}
			}

			const label =
				hasOverride && effectiveThreshold != null
					? `${t("session.action")} ${Math.round(Number(effectiveThreshold) / 1000)}k`
					: t("session.action");

			return jsxs(Fragment, {
				children: [
					jsx("button", {
						type: "button",
						title: t("session.action.aria"),
						"aria-label": t("session.action.aria"),
						onClick: () => setOpen(true),
						style: {
							display: "inline-flex",
							alignItems: "center",
							gap: 4,
							minHeight: 28,
							padding: "3px 8px",
							borderRadius: 6,
							border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))",
							background: hasOverride ? "var(--dsw-alias-fill-l2, rgba(0,0,0,0.06))" : "transparent",
							color: "var(--dsw-alias-label-secondary, inherit)",
							cursor: "pointer",
							fontSize: 12,
							lineHeight: "18px",
						},
						children: label,
					}),
					jsx(primitives.Modal, {
						open,
						onClose: () => setOpen(false),
						title: t("session.title"),
						children: jsxs("div", {
							style: { display: "flex", flexDirection: "column", gap: 14, minWidth: 320, padding: "4px 2px 8px" },
							children: [
								jsx("p", { style: hintStyle, children: t("session.desc") }),
								jsx("p", {
									style: hintStyle,
									children: `${t("session.effective")}: ${effectiveThreshold ?? "—"} · ${t("session.global")}: ${value?.thresholdTokens ?? "—"}`,
								}),
								jsx(TokenSliderField, {
									label: t("field.threshold"),
									desc: t("field.threshold.desc"),
									value: threshold,
									onChange: setThreshold,
									disabled: busy,
									max: contextMax,
									known: capKnown,
									t,
									allowEmpty: true,
									placeholder: t("placeholder.follow"),
								}),
								jsxs("label", {
									style: fieldBox,
									children: [
										jsx("span", { style: { fontWeight: 500, fontSize: 13 }, children: t("field.retain") }),
										jsx("input", {
											type: "number",
											placeholder: t("placeholder.follow"),
											value: retain,
											disabled: busy,
											onChange: (e) => setRetain(e.target.value),
											style: inputStyle,
										}),
									],
								}),
								jsxs("label", {
									style: fieldBox,
									children: [
										jsx("span", { style: { fontWeight: 500, fontSize: 13 }, children: t("field.maxAttempts") }),
										jsx("input", {
											type: "number",
											placeholder: t("placeholder.follow"),
											value: maxAttempts,
											disabled: busy,
											onChange: (e) => setMaxAttempts(e.target.value),
											style: inputStyle,
										}),
									],
								}),
								jsxs("div", {
									style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 },
									children: [
										jsx(primitives.Button, {
											variant: "outline",
											size: "sm",
											disabled: busy,
											onClick: save,
											children: busy ? t("saving") : t("save"),
										}),
										jsx(primitives.Button, {
											variant: "ghost",
											size: "sm",
											disabled: busy || !hasOverride,
											onClick: clearOverride,
											children: t("session.clear"),
										}),
										status.text
											? jsx("span", {
													style: {
														fontSize: 12,
														color:
															status.kind === "ok"
																? "var(--dsw-alias-state-success-primary, #2a7)"
																: "var(--dsw-alias-label-error, #c44)",
													},
													children: status.text,
												})
											: null,
									],
								}),
							],
						}),
					}),
				],
			});
		}

		const inject = ["slots", "locale", "connection", "remote", "settingsScope"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "kur-compact-trigger: dictionaries");
			const t = ctx.locale.bind(NS);
			const scope = ctx.settingsScope.bind({
				namespace: SETTINGS_NS,
				decode: decodeValue,
			});
			const api = ctx.connection.api;

			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "kur-compact-trigger",
						order: 55,
						label: () => t("nav"),
						locale: NS,
						inject: () => ({ scope, api }),
					},
					CompactTriggerSection,
				),
			);

			// sessionId 来自 session scope 标准 props；不要在 inject 里伪造。
			ctx.slots.inject("conversation.session.header.actions", () =>
				ctx.slots.register(
					{
						name: "conversation.session.header.actions",
						id: "kur-compact-trigger",
						order: 40,
						locale: NS,
						inject: () => ({ scope, api }),
					},
					SessionCompactAction,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = "kur-compact-trigger";
		return module.exports;
	},
});
