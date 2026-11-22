import { cn } from "../lib/utils";
import type { ReactNode } from "react";
import { modelBrand } from "../sidebarPersonalization";
import { ClaudeAI, OpenAI } from "./Icons";
import deepseek from "../../../../packages/shared/assets/model-icons/deepseek.svg";
import gemini from "../assets/model-icons/gemini.svg";
import qwen from "../assets/model-icons/qwen.svg";

import kimi from "../../../../packages/shared/assets/model-icons/kimi.svg";
import zhipu from "../assets/model-icons/zhipu.svg";
import minimax from "../assets/model-icons/minimax.svg";
import doubao from "../assets/model-icons/doubao.svg";
import baidu from "../assets/model-icons/baidu.svg";
import hunyuan from "../assets/model-icons/hunyuan.svg";
import stepfun from "../assets/model-icons/stepfun.svg";
import yi from "../assets/model-icons/yi.svg";

const images = {
  deepseek,
  gemini,
  qwen,
  kimi,
  zhipu,
  minimax,
  doubao,
  baidu,
  hunyuan,
  stepfun,
  yi,
};

export function ModelBrandIcon({
  model,
  fallback,
  className,
}: {
  model: string;
  fallback: ReactNode;
  className?: string;
}) {
  const brand = modelBrand(model);
  if (!brand) return fallback;
  if (brand === "claude") return <ClaudeAI className={cn("size-4", className)} />;
  if (brand === "openai") return <OpenAI className={cn("size-4", className)} />;
  return (
    <span
      className={cn("size-4 shrink-0 bg-current", className)}
      style={{ mask: `url("${images[brand]}") center / contain no-repeat` }}
      aria-hidden
    />
  );
}
