export function RemixIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 5v5a4 4 0 0 1-4 4H5" />
      <polyline points="9 10 5 14 9 18" />
    </svg>
  );
}
