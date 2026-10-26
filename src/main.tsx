import { createRoot } from "react-dom/client";
import "./styles.css";
import { GameApp } from "@/game/GameApp";
createRoot(document.getElementById("root")!).render(<GameApp />);
