/**
 * A section's rule: the dashed line with its plus marks, and the bracketed
 * label riding under it in its own band — the app's device, shared so every
 * page's sections are cut from the same rail.
 */
export function SectionRule({ label }: { label?: string }) {
  return (
    <>
      <div className="rule" aria-hidden />
      {label && (
        <div className="flex items-center px-6 py-4 sm:px-10" style={{ borderBottom: "1px dashed var(--line)" }}>
          <span className="label">[ {label} ]</span>
        </div>
      )}
    </>
  );
}
