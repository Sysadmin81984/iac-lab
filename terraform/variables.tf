variable "ssh_public_key_path" {
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
  description = "Path to public SSH key"
}

variable "ssh_private_key_path" {
  type        = string
  default     = "~/.ssh/id_ed25519"
  description = "Path to private SSH key"
}

