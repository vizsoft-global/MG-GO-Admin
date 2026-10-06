export function commentBodyValid(body: string): boolean {
  return body.trim().length > 0;
}

export function canRiderReadComments(): false {
  return false;
}
