// gap-px 网格的容器底色会在末行不满时露出：按各断点列数补齐表面色占位格的类名。
export function gridFillers(count: number): string[] {
  const fMd = (2 - (count % 2)) % 2;
  const fLg = (3 - (count % 3)) % 3;
  const both = Math.min(fMd, fLg);
  return [
    ...Array<string>(fMd - both).fill("hidden md:block lg:hidden"),
    ...Array<string>(both).fill("hidden md:block"),
    ...Array<string>(fLg - both).fill("hidden lg:block"),
  ];
}
