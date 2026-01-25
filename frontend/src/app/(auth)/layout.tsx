export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Pericles
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Supply Chain Risk Management
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
