import type { ReactNode } from "react";
import { modelBrand, useSidebarPersonalization } from "../../sidebarPersonalization";
import { ModelBrandIcon } from "../ModelBrandIcon";

export function SidebarModelIcon(props: { model: string; harness: ReactNode }) {
  const [settings] = useSidebarPersonalization();
  const brand = modelBrand(props.model);
  if (!brand || settings.modelIcons === "harness") return props.harness;
  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      <ModelBrandIcon model={props.model} fallback={props.harness} />
      {settings.modelIcons === "both" ? (
        <span className="absolute -right-1.5 -bottom-1.5 flex size-3 items-center justify-center rounded-sm bg-sidebar [&_svg]:size-2.5">
          {props.harness}
        </span>
      ) : null}
    </span>
  );
}
