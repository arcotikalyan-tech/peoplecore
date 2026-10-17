export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded-md bg-subtle" />
      <div className="h-4 w-72 rounded-md bg-subtle" />
      <div className="h-64 rounded-lg bg-subtle" />
    </div>
  );
}
