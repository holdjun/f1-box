<script lang="ts">
  import type { RaceSession } from "../lib/race-results-repository.js";
  import { formatLocalDateTime, formatUtcDateTime } from "../lib/time.js";

  interface Props {
    sessions: RaceSession[];
  }

  // 水合前 SSR 输出 UTC 时间，无 JS 也可读；按钮切换用户本地时区
  let { sessions }: Props = $props();
  let useLocal = $state(false);

  const format = (session: RaceSession): string =>
    useLocal
      ? formatLocalDateTime(session.startsAtUtc)
      : formatUtcDateTime(session.startsAtUtc);
</script>

<div
  class="weekend-schedule__bar relative z-10 mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"
>
  <h2 class="text-[0.72rem] font-semibold tracking-[0.09em] uppercase text-ink-muted">
    Weekend schedule
  </h2>
  <button
    type="button"
    class="cursor-pointer rounded-sm border border-line px-2.5 py-1 text-[0.68rem] font-semibold tracking-[0.08em] uppercase text-ink-strong transition-colors hover:border-accent"
    aria-pressed={useLocal}
    onclick={() => (useLocal = !useLocal)}
    aria-label="Toggle session times between UTC and your local time"
    data-time-toggle
  >
    {useLocal ? "Your time" : "UTC"}
  </button>
</div>
<ol class="weekend-schedule list-none p-0">
  {#each sessions as session, index (session.key)}
    <li
      class="grid min-h-28 grid-cols-[3rem_1fr] items-center gap-3 border-b border-line py-4 md:grid-cols-[6rem_1fr_auto] md:gap-6"
    >
      <span
        class="font-display text-2xl text-ink-muted md:text-[2.6rem]"
        aria-hidden="true"
        >{String(index + 1).padStart(2, "0")}</span
      >
      <div>
        <h3 class="mb-1.5 text-[1.75rem]">{session.label}</h3>
        <time
          class="block text-[0.76rem] tabular-nums text-ink-strong"
          datetime={session.startsAtUtc}
          data-session-time
        >{format(session)}</time>
      </div>
    </li>
  {/each}
</ol>