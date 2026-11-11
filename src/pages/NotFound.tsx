import { PageHeader } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="QUANTORA" title="Page not found" description="The requested route does not exist." />
      <section className="panel p-6 text-[13px] text-mut">This section is being assembled.</section>
    </div>
  );
}
