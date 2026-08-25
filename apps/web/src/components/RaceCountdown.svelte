<script lang="ts">
  interface Session {
    key: string;
    label: string;
    startsAtUtc: string;
  }

  interface Props {
    sessions: Session[];
  }

  // 倒计时目标 = 下一个未开始的 session（练习赛 → 排位 → 正赛自动推进）
  let { sessions }: Props = $props();
  let now = $state(Date.now());

  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });

  const next = $derived(
    sessions.find((session) => new Date(session.startsAtUtc).getTime() > now),
  );
  const diffMs = $derived(
    next ? Math.max(0, new Date(next.startsAtUtc).getTime() - now) : 0,
  );
  const countdown = $derived.by(() => {
    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hh = String(Math.floor((totalSeconds % 86400) / 3600)).padStart(2, "0");
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
  });
  const countdownId = $derived(next?.key ?? "");
</script>

{#if next}
  <p
    class="countdown mt-2 flex items-baseline gap-2 text-[0.8rem] tabular-nums text-ink-strong"
  >
    <span class="text-[0.66rem] font-semibold tracking-[0.08em] uppercase text-ink-muted"
      >{next.label}</span
    >
    <svg
      class="size-3.5 self-center fill-none stroke-current stroke-[1.6]"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5"></circle>
      <path d="M8 4.5v3.8l2.6 1.5"></path>
    </svg>
    <span data-countdown-id={countdownId}>{countdown}</span>
  </p>
{:else}
  <p
    class="mt-2 text-[0.8rem] text-ink-strong"
    data-countdown-over
  >Race weekend in progress</p>
{/if}