<script lang="ts">
  import { onMount } from "svelte";
  import type { RaceSession } from "../lib/race-results-repository.js";
  import { formatLocalDateTime, formatUtcDateTime } from "../lib/time.js";

  interface Props {
    sessions: RaceSession[];
    timeZone: string | null;
  }

  let { sessions, timeZone }: Props = $props();

  // 渐进增强：SSR 渲染 UTC，水合后 My time 用浏览器时区重排；
  // Track time 服务端即正确，无需 JS。
  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  // 无时区映射（f1db 新增赛道尚未补进 circuit-timezones.json）时只能给 UTC，
  // 标签必须跟着改——把 UTC 时刻标成 Track time 比不显示更糟
  const trackLabel = $derived(timeZone === null ? "UTC" : "Track time");

  const trackTime = (session: RaceSession): string =>
    timeZone === null
      ? formatUtcDateTime(session.startsAtUtc)
      : formatLocalDateTime(session.startsAtUtc, timeZone);

  const myTime = (session: RaceSession): string =>
    hydrated
      ? formatLocalDateTime(session.startsAtUtc)
      : formatUtcDateTime(session.startsAtUtc);
</script>

<div
  class="weekend-schedule__bar relative z-10 mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"
>
  <h2 class="text-[0.72rem] font-semibold tracking-[0.09em] uppercase text-ink-muted">
    Weekend schedule
  </h2>
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
        <div class="flex flex-wrap items-baseline gap-x-8 gap-y-1">
          <div>
            <span class="block text-[0.68rem] uppercase tracking-[0.08em] text-ink-muted">My time</span>
            <time
              class="block text-[0.76rem] tabular-nums text-ink-strong"
              datetime={session.startsAtUtc}
              data-my-time
            >{myTime(session)}</time>
          </div>
          <div>
            <span class="block text-[0.68rem] uppercase tracking-[0.08em] text-ink-muted">{trackLabel}</span>
            <time
              class="block text-[0.76rem] tabular-nums text-ink-strong"
              datetime={session.startsAtUtc}
              data-track-time
            >{trackTime(session)}</time>
          </div>
        </div>
      </div>
    </li>
  {/each}
</ol>
