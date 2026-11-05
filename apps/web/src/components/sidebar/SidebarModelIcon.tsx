import type { ReactNode } from "react";
import { modelBrand, useSidebarPersonalization } from "../../sidebarPersonalization";
import { ClaudeAI, OpenAI } from "../Icons";
import deepseek from "../../assets/model-icons/deepseek.svg";
import gemini from "../../assets/model-icons/gemini.svg";
import qwen from "../../assets/model-icons/qwen.svg";

import kimi from "../../assets/model-icons/kimi.svg";
import zhipu from "../../assets/model-icons/zhipu.svg";
import minimax from "../../assets/model-icons/minimax.svg";
import doubao from "../../assets/model-icons/doubao.svg";
import baidu from "../../assets/model-icons/baidu.svg";
import hunyuan from "../../assets/model-icons/hunyuan.svg";
import stepfun from "../../assets/model-icons/stepfun.svg";
import yi from "../../assets/model-icons/yi.svg";

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

export function SidebarModelIcon(props: { model: string; harness: ReactNode }) {
  const [settings] = useSidebarPersonalization();
  const brand = modelBrand(props.model);
  if (!brand || settings.modelIcons === "harness") return props.harness;
  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      {brand === "claude" ? (
        <ClaudeAI className="size-4" />
      ) : brand === "openai" ? (
        <OpenAI className="size-4" />
      ) : (
        <span
          className="size-4 bg-current"
          style={{ mask: `url("${images[brand]}") center / contain no-repeat` }}
          aria-hidden
        />
      )}
      {settings.modelIcons === "both" ? (
        <span className="absolute -right-1.5 -bottom-1.5 flex size-3 items-center justify-center rounded-sm bg-sidebar [&_svg]:size-2.5">
          {props.harness}
        </span>
      ) : null}
    </span>
  );
}
