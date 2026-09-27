/**
 * Simplified Starbucks siren silhouette — recognisable at small sizes.
 * Crown with three points, face, body, and twin tails arching upward.
 */
export default function SirenIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Crown — three points */}
      <path d="M7.5 8.5 L9.5 4.5 L12 7 L14.5 4.5 L16.5 8.5" />

      {/* Head */}
      <circle cx="12" cy="11" r="2.2" fill="currentColor" stroke="none" />

      {/* Body / torso */}
      <path
        d="M9.5 13.2 C9 15.5 9.5 17.5 12 18.5 C14.5 17.5 15 15.5 14.5 13.2"
        fill="currentColor"
        stroke="none"
      />

      {/* Left tail — arcs out and curls */}
      <path d="M9.5 17 C7.5 18 5.5 19 4.5 21.5" />

      {/* Right tail — mirrors left */}
      <path d="M14.5 17 C16.5 18 18.5 19 19.5 21.5" />
    </svg>
  )
}
