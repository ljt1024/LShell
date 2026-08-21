import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Website from "./website/Website";

const isDesktop = Boolean(window.lshellDesktop);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isDesktop ? <App /> : <Website />}
  </React.StrictMode>
);
