## API Report File for "@fluidframework/view-adapters"

> Do not edit this file. It is a report generated by [API Extractor](https://api-extractor.com/).

```ts

import { FluidObject } from '@fluidframework/core-interfaces';
import { IFluidMountableView } from '@fluidframework/view-interfaces';

// @public
export class MountableView implements IFluidMountableView {
    constructor(view: FluidObject);
    // (undocumented)
    static canMount(view: FluidObject): boolean;
    // (undocumented)
    get IFluidMountableView(): MountableView;
    // (undocumented)
    mount(container: HTMLElement): void;
    // (undocumented)
    unmount(): void;
}

```
