import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/lib/auth";
import { useLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import aceLogo from "@assets/ace_logo_new_1781354030491.jpg";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export default function Login() {
  const [, setLocation] = useLocation();
  const { setAuth } = useAuth();
  const { toast } = useToast();
  const loginMutation = useLogin();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { username: "", password: "" },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    loginMutation.mutate(
      { data: values },
      {
        onSuccess: (data) => {
          setAuth(data.user, data.accessToken, data.refreshToken);
          setLocation(data.user.role === "physician" ? "/physician/search" : "/dashboard");
        },
        onError: () => {
          toast({ title: "Login Failed", description: "Invalid credentials. Please try again.", variant: "destructive" });
        },
      }
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">

      {/* ── Green branding strip ───────────────────────────────── */}
      <div className="bg-[#1a5c2a] flex flex-col items-center pt-10 pb-8 px-6 text-center text-white">
        <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center shadow-lg ring-4 ring-white/20 mb-3">
          <img src={aceLogo} alt="ACE Medical Center" className="w-[72px] h-[72px] object-contain rounded-full" />
        </div>
        <h1 className="text-lg font-extrabold tracking-wide uppercase">Allied Care Experts</h1>
        <p className="text-xs font-semibold tracking-widest text-green-200 uppercase mt-0.5">Medical Center · Cebu</p>
      </div>

      {/* ── Login form ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col justify-center px-5 py-8">
        <div className="w-full max-w-sm mx-auto space-y-6">

          <div className="text-center space-y-0.5">
            <h2 className="text-lg font-bold text-gray-800">Staff Sign In</h2>
            <p className="text-sm text-gray-500">Secure access for hospital personnel</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">Username</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter username" className="h-11" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Enter password" className="h-11" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full h-11 bg-[#1a5c2a] hover:bg-[#155224] text-white font-semibold rounded-xl"
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? "Signing in…" : "Sign In"}
                </Button>
              </form>
            </Form>
          </div>

          <div className="text-center border-t border-gray-200 pt-5">
            <p className="text-sm text-gray-500">
              Are you a patient?{" "}
              <Link href="/portal" className="text-[#1a5c2a] font-semibold hover:underline">
                Access Patient Portal
              </Link>
            </p>
            <p className="text-sm text-gray-500 mt-2">
              <Link href="/" className="text-gray-400 hover:text-gray-600 text-xs">
                ← Back to Home
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
