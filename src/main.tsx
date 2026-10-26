import { createRoot } from "react-dom/client";
import "./fonts.css";
import "./styles.css";
import { GameApp } from "@/game/GameApp";
createRoot(document.getElementById("root")!).render(<GameApp />);
