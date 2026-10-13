/**
 * Reference-counted credits: eight PNOA tiles share one attribution text, and Cesium's credit
 * display treats equal credits as one, so hiding one layer must not remove the credit that the
 * other visible layers still need. The credit is added with the first layer that shows it and
 * removed with the last one.
 */
export class SharedCredits<C> {
  private readonly shown = new Map<string, { credit: C; count: number }>();
  constructor(
    private readonly add: (credit: C) => void,
    private readonly remove: (credit: C) => void,
  ) {}
  show(text: string, make: () => C) {
    const entry = this.shown.get(text);
    if (entry) {
      entry.count++;
      return;
    }
    const credit = make();
    this.shown.set(text, { credit, count: 1 });
    this.add(credit);
  }
  hide(text: string) {
    const entry = this.shown.get(text);
    if (!entry) return;
    if (--entry.count > 0) return;
    this.shown.delete(text);
    this.remove(entry.credit);
  }
  get size() {
    return this.shown.size;
  }
}
