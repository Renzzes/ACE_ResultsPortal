import { Redirect } from "wouter";

/** Settings now opens from the header as a modal. */
export default function PhysicianSettings() {
  return <Redirect to="/physician/overview" />;
}
