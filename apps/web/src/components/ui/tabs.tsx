import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "~/lib/utils";
import { toggleVariants } from "./toggle";

function Tabs({
  className,
  ...props
}: Omit<TabsPrimitive.Root.Props, "className"> & { className?: string }) {
  return <TabsPrimitive.Root className={cn("flex min-h-0 flex-col gap-4", className)} {...props} />;
}

function TabsList({
  className,
  ...props
}: Omit<TabsPrimitive.List.Props, "className"> & { className?: string }) {
  return (
    <TabsPrimitive.List
      className={cn("flex w-fit gap-0.5 rounded-lg bg-input/40 p-0.5", className)}
      {...props}
    />
  );
}

function TabsTab(props: Omit<TabsPrimitive.Tab.Props, "render" | "className">) {
  return (
    <TabsPrimitive.Tab
      {...props}
      className={toggleVariants({ variant: "segmented", size: "segmented" })}
      render={(props, state) => <button {...props} data-pressed={state.active ? "" : undefined} />}
    />
  );
}

function TabsPanel(props: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel keepMounted {...props} />;
}

export { Tabs, TabsList, TabsTab, TabsPanel };
