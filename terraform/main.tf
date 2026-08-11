terraform {
  required_version = ">= 1.0.0"
  required_providers {
    multipass = {
      source  = "larstobi/multipass"
      version = "~> 1.4.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.4.0"
    }
  }
}

provider "multipass" {}

# Читаємо ваш SSH-ключ з системи
data "local_file" "public_key" {
  filename = pathexpand(var.ssh_public_key_path)
}

# Створюємо cloud-init з вашим SSH-ключем
resource "local_file" "rendered_cloud_init" {
  content = templatefile("${path.module}/cloud-init.yaml", {
    ssh_key = trimspace(data.local_file.public_key.content)
  })
  filename = "${path.module}/cloud-init-rendered.yaml"
}

# Створюємо ВМ в Multipass
resource "multipass_instance" "web" {
  name           = "clean-lab-server"
  cpus           = 2
  memory         = "2Gb"
  disk           = "6Gb"
  image          = "22.04"
  cloudinit_file = local_file.rendered_cloud_init.filename
}

# Автоматично генеруємо inventory.ini для Ansible
resource "local_file" "ansible_inventory" {
  content  = <<EOF
[webservers]
clean-lab-server ansible_host=${multipass_instance.web.ipv4} ansible_user=ubuntu ansible_ssh_private_key_file=${var.ssh_private_key_path} ansible_ssh_common_args='-o StrictHostKeyChecking=no'
EOF
  filename = "${path.module}/../ansible/inventory.ini"
}

output "server_ip" {
  value       = multipass_instance.web.ipv4
  description = "IP address of the created VM"
}

