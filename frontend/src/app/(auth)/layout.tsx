export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground">
            Pericles
          </h1>
          <p className="mt-2 text-muted-foreground">
            Supply Chain Risk Management
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
