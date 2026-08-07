import type { SVGProps } from "react";

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    shield: <><path d="M12 3 5 6v5c0 4.6 2.9 8 7 10 4.1-2 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
    wallet: <><path d="M4 6.5h14a2 2 0 0 1 2 2v9H6a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h11"/><path d="M16 11h4v4h-4a2 2 0 1 1 0-4Z"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    pulse: <><path d="M3 12h4l2-5 4 10 2-5h6"/></>,
    proof: <><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v5h5M10 13l2 2 4-4"/></>,
    price: <><circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.7-.5-1.5-.8-2.5-.8-1.4 0-2.5.7-2.5 1.8 0 2.8 5.5 1.2 5.5 4.2 0 1.2-1.2 2.1-2.8 2.1-1.1 0-2.2-.3-3-.9M12.5 5.8v12.4"/></>,
    decision: <><path d="M4 4h16v16H4z"/><path d="m8 12 3 3 5-6"/></>,
    vault: <><rect x="3" y="5" width="18" height="15" rx="3"/><circle cx="12" cy="12" r="3"/><path d="M12 9V5m0 10v5"/></>,
    arrow: <path d="m9 18 6-6-6-6"/>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6H5V6h6"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    zoomin: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M10 7v6M7 10h6"/></>,
    zoomout: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6"/></>,
    reset: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
